# Arquitetura

## Limites arquiteturais

O serviço segue quatro áreas orientadas por dependências:

- **Domain** contém objetos de valor, entidades e invariantes financeiros. Não possui imports do NestJS, ORM, banco de dados ou AWS.
- **Application** contém casos de uso e portas. HTTP e SQS chamarão o mesmo caso de uso de processamento de apostas.
- **Infrastructure** contém MikroORM, PostgreSQL, SQS, migrations, workers e adaptadores operacionais.
- **Presentation** contém contratos HTTP, validações e mapeamento de erros.

Este projeto é um monólito modular. Múltiplas instâncias sem estado compartilharão PostgreSQL e SQS. Microserviços distribuídos adicionariam modos de falha sem melhorar as garantias financeiras exigidas pelo desafio.

## Money

Valores monetários entram e saem do sistema como strings decimais exatas com duas casas. A biblioteca `decimal.js` realiza a aritmética e o PostgreSQL armazena os valores como `NUMERIC(20, 2)`. O tipo `number` do JavaScript nunca é utilizado para representação monetária.

`Money.from` rejeita entradas externas negativas, notação científica, escala não canônica, moedas ISO-4217 não suportadas e valores que excedem a precisão do banco. A aritmética interna pode produzir um `Money` negativo, necessário para operações como diferenças de reconciliação e `negate()`.

## Criação de wallet

`CreateWalletUseCase` não depende de NestJS nem do MikroORM. Ele cria o agregado `Wallet` com versão inicial `1`. Quando o saldo inicial é positivo, também cria uma `WagerTransaction` interna do tipo `OPENING` e um `WalletLedgerEntry` de crédito, partindo de `0.00` até o saldo informado.

O adaptador MikroORM persiste wallet, transação e ledger em uma única transação PostgreSQL. Os inserts são executados na ordem das chaves estrangeiras e qualquer falha provoca rollback integral. A constraint única `(player_id, currency)` é a garantia definitiva contra duas wallets para o mesmo jogador e moeda.

O domínio utiliza `Money`; os registros de persistência convertem os valores somente na borda para strings `NUMERIC(20, 2)`. Entidades específicas do ORM não atravessam para as camadas de domínio ou aplicação.

## Máquina de estados das transações

Transações externas são criadas por `WagerTransaction.create` no estado `PENDING`. A transação interna `OPENING` possui uma factory separada, nasce em `PROCESSED` e não pode ser submetida pela API ou pela fila. A factory `rehydrate` apenas reconstrói o estado persistido, sem repetir validações de transição.

As transições permitidas são:

| Estado atual | Próximos estados permitidos |
|---|---|
| `PENDING` | `PENDING_REFERENCE`, `PROCESSED`, `REJECTED`, `FAILED` |
| `PENDING_REFERENCE` | `PROCESSED`, `REJECTED`, `FAILED` |
| `PROCESSED` | nenhum |
| `REJECTED` | nenhum |
| `FAILED` | nenhum |

`PROCESSED`, `REJECTED` e `FAILED` são terminais. Qualquer tentativa de alterar uma transação terminal lança `InvalidTransactionStateError`. Rejeições e falhas carregam um código estável e legível por máquina; a taxonomia cobre saldo insuficiente, divergências de wallet, jogador, moeda, provedor ou rodada, referência ausente ou inválida, reversão duplicada, reversão que produziria saldo negativo e falha permanente de infraestrutura.

`REFUND` e `ROLLBACK` exigem referência externa; `WIN` aceita referência opcional; `BET` e `LOSS` não aceitam referência. Antes de calcular o lançamento, o domínio verifica se a referência está `PROCESSED` e pertence ao mesmo provedor, jogador, wallet, moeda e rodada. Reversões também exigem o mesmo valor. `REFUND` gera crédito e `ROLLBACK` inverte a direção financeira de `BET`, `WIN` ou `REFUND`. `LOSS` não possui direção de ledger porque não altera saldo.

## Matriz financeira das operações

`WagerOperationProcessor` é um serviço de domínio sem dependências de framework ou persistência. Ele recebe a transação, a wallet e a referência já carregadas, aplica as regras abaixo e devolve o lançamento imutável quando houver mudança de saldo.

| Operação | Efeito | Resultado no ledger |
|---|---|---|
| `BET` | débito; rejeita saldo insuficiente | um `DEBIT` quando processada |
| `WIN` | crédito; referência a BET é opcional | um `CREDIT` |
| `LOSS` | não altera saldo nem versão da wallet | nenhum lançamento |
| `REFUND` | crédito do mesmo valor da BET referenciada | um `CREDIT` |
| `ROLLBACK` de BET | desfaz o débito | um `CREDIT` |
| `ROLLBACK` de WIN ou REFUND | desfaz o crédito; pode ser rejeitado se produzir saldo negativo | um `DEBIT` quando processado |

Referências ausentes deixam a transação em `PENDING_REFERENCE`, sem alterar saldo. Referências incompatíveis, saldo insuficiente e reversões repetidas levam a `REJECTED`, com `failureCode` específico e sem ledger. Uma transação terminal é recusada antes de qualquer mutação da wallet.

A informação de que já existe uma reversão do mesmo tipo entra no processador como contexto. `ProcessWagerTransactionUseCase` obtém essa informação sob o lock da wallet, enquanto o índice único parcial do PostgreSQL permanece como proteção definitiva contra a corrida entre reversões.

## Garantias do banco de dados

O schema inicial estabelece as cinco tabelas obrigatórias:

- `wallets`;
- `wager_transactions`;
- `wallet_ledger_entries`;
- `inbox_messages`;
- `outbox_messages`.

O PostgreSQL garante saldo não negativo nas wallets, idempotência única por `(provider_id, idempotency_key)`, transação externa única por `(provider_id, external_transaction_id)`, no máximo uma reversão processada de cada tipo, aritmética do ledger e no máximo um lançamento por wallet/transação. Um trigger rejeita qualquer `UPDATE` ou `DELETE` no ledger.

O registro da transação inclui um snapshot da resposta para que um replay idempotente retorne o resultado originalmente observado, em vez de um saldo posterior da wallet.

## Concorrência e idempotência

`MikroOrmWagerProcessingRepository` abre uma transação SQL e adquire lock pessimista `FOR UPDATE` somente na linha da wallet afetada. Não existe lock financeiro global, portanto wallets distintas continuam processando em paralelo.

O caso de uso consulta idempotência e ID externo antes do lock para responder replays rapidamente e repete as consultas depois do lock para fechar a janela de concorrência. As constraints do banco são a garantia final. Se duas transações em wallets diferentes disputarem a mesma chave, o adaptador converte a violação de unicidade em uma única repetição controlada, que então retorna replay ou conflito.

Wallet, `WagerTransaction` e `WalletLedgerEntry` são persistidos na mesma transação. Uma falha no ledger reverte também o insert da transação e a atualização do saldo. O snapshot da resposta armazena o saldo observado no processamento; por isso um replay posterior não devolve o saldo atual da wallet.

## Inbox, consumer SQS e atomicidade

O `WagerSqsMessageHandler` valida o envelope e chama o mesmo `ProcessWagerTransactionUseCase` usado pela API. O registro da inbox é criado antes da regra financeira, mas permanece na mesma transação PostgreSQL; qualquer erro desfaz inbox, transação, wallet, ledger e outbox. O ACK do SQS só ocorre depois do retorno do commit. Uma redelivery com o mesmo hash devolve replay; o mesmo `messageId` com outro hash é conflito.

Falhas de processamento não recebem ACK. A visibilidade da mensagem permite nova entrega e a redrive policy nativa move a mensagem para a DLQ após cinco recebimentos. No shutdown, o receive de long polling é abortado e o processo aguarda as mensagens já iniciadas.

## Transactional Outbox

Cada resultado cria subclasses concretas e versionadas de `IntegrationEvent`. IDs são derivados deterministicamente da transação e da transição; isso estabiliza a identidade do evento durante retries. `WagerTransactionProcessed`, `WagerTransactionRejected`, `WagerTransactionPendingReference` e `WalletBalanceChanged` são gravados junto da operação financeira.

Publishers concorrentes reservam eventos com `FOR UPDATE SKIP LOCKED`. O lease de 30 segundos permite que outra instância recupere trabalho abandonado. Falhas limpam o lock e agendam backoff exponencial. A entrega é pelo menos uma vez (*at-least-once*): uma falha depois do envio e antes de `published_at` pode duplicar a publicação, portanto o `eventId` é a chave idempotente do consumidor.

O agrupamento do SQS FIFO é apenas uma otimização. Constraints e locks do PostgreSQL continuam sendo a fonte de correção.

## Referências pendentes

O worker seleciona transações vencidas por `next_reference_attempt_at` com `FOR UPDATE SKIP LOCKED`. Cada tentativa ocorre em transação própria, bloqueia somente a wallet correspondente e reutiliza o `WagerOperationProcessor`. O backoff começa em cinco segundos, termina em cinco minutos e o limite é oito tentativas. O esgotamento produz `REJECTED/REFERENCE_NOT_FOUND`; nenhuma transação permanece pendente indefinidamente.

## API HTTP

`WageringController` recebe o header obrigatório `Idempotency-Key`, valida o DTO e delega integralmente ao `ProcessWagerTransactionUseCase`. O controller não contém regra financeira. O consumer SQS chama o mesmo caso de uso com contexto de inbox.

Os resultados são diferenciados por status HTTP: processada `200`, referência pendente `202`, payload inválido `400`, recurso ausente `404`, conflito persistente `409`, rejeição de negócio `422` e indisponibilidade `503`. Erros automáticos de DTO seguem o envelope com código `VALIDATION_ERROR`; os demais erros expõem códigos estáveis específicos.

As consultas de wallet, transação e ledger utilizam repositórios de leitura que retornam views da camada de aplicação. Entidades do MikroORM não atravessam a fronteira HTTP.

## Paginação do ledger e reconciliação

O ledger é ordenado por `(created_at DESC, id DESC)`. O cursor Base64URL carrega uma versão de contrato, a wallet, o instante e o identificador do último lançamento retornado. O adaptador valida integralmente o cursor e o caso de uso impede seu reaproveitamento em outra wallet. A consulta seguinte usa keyset pagination com a condição `(created_at, id) < (?, ?)`, em vez de `OFFSET`; assim, novos lançamentos mais recentes não deslocam os itens das páginas seguintes. O índice `wallet_ledger_entries_cursor_idx` segue a mesma ordem da consulta.

A reconciliação lê o saldo armazenado e agrega `NUMERIC` diretamente no PostgreSQL, mantendo valores monetários como strings decimais nas fronteiras. A aplicação reconstrói o saldo por `créditos - débitos`, calcula a diferença como `saldo armazenado - saldo calculado` com `Money` e informa quantos lançamentos foram verificados.

Uma divergência não executa correção automática. O monitor registra um evento estruturado sem incluir os valores financeiros e incrementa `reconciliation_divergences_total`.

## Observabilidade

O processo usa logger JSON. Operações carregam, quando disponíveis, `correlationId`, `messageId`, `transactionId`, `walletId` e `providerId`, sem payload monetário completo. `GET /metrics` expõe contadores e gauges compatíveis com Prometheus para status, duplicatas, retries, DLQ, concorrência, latência, reconciliação e atraso da outbox. Liveness avalia o processo; readiness consulta PostgreSQL e SQS separadamente.

## Decisão sobre autenticação

A autenticação foi retirada das prioridades de implementação dos três dias porque o desafio oficial não atribui pontos a ela. Os endpoints de saúde permanecem públicos e o SQS é tratado como canal interno. A camada HTTP manterá um ponto de extensão de guard para um provedor OIDC externo, como Keycloak. Nenhum sistema local de senhas será desenvolvido.

## Limitações e trade-offs

A autenticação foi deliberadamente deixada como ponto de extensão OIDC. Métricas ficam em memória por instância e devem ser coletadas individualmente pelo Prometheus. A entrega da outbox não promete *exactly-once* externo; ela promete não perder eventos confirmados e fornece identidade estável para deduplicação. Teste de carga é diferencial opcional e não faz parte da entrega atual.
