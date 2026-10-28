# Arquitetura

## Limites arquiteturais

O serviço segue quatro áreas orientadas por dependências:

- **Domain** contém objetos de valor, entidades e invariantes financeiros. Não possui imports do NestJS, ORM, banco de dados ou AWS.
- **Application** conterá casos de uso e portas. HTTP e SQS chamarão o mesmo caso de uso de processamento de apostas.
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

## Garantias do banco de dados

O schema inicial estabelece as cinco tabelas obrigatórias:

- `wallets`;
- `wager_transactions`;
- `wallet_ledger_entries`;
- `inbox_messages`;
- `outbox_messages`.

O PostgreSQL garante saldo não negativo nas wallets, unicidade da idempotência, unicidade das transações do provedor, aritmética do ledger e no máximo um lançamento por wallet/transação. Um trigger rejeita qualquer `UPDATE` ou `DELETE` no ledger.

O registro da transação inclui um snapshot da resposta para que um replay idempotente retorne o resultado originalmente observado, em vez de um saldo posterior da wallet.

## Concorrência e semântica de entrega planejadas

A aplicação adquirirá um lock pessimista na linha da wallet afetada. Quando uma operação precisar de mais de um lock, eles serão adquiridos em uma ordem estável por ID da wallet. Não haverá lock financeiro global.

Alterações financeiras, ledger, inbox e outbox serão confirmados em uma única transação PostgreSQL. A entrega da outbox será pelo menos uma vez (*at-least-once*): publishers concorrentes reservarão registros prontos com lease/`SKIP LOCKED`. Uma falha após a publicação e antes da confirmação do registro pode duplicar um evento; por isso, IDs de eventos e consumidores devem ser idempotentes.

O agrupamento do SQS FIFO é apenas uma otimização. Constraints e locks do PostgreSQL continuam sendo a fonte de correção.

## Decisão sobre autenticação

A autenticação foi retirada das prioridades de implementação dos três dias porque o desafio oficial não atribui pontos a ela. Os endpoints de saúde permanecem públicos e o SQS é tratado como canal interno. A camada HTTP manterá um ponto de extensão de guard para um provedor OIDC externo, como Keycloak. Nenhum sistema local de senhas será desenvolvido.

## Limitações atuais

A versão atual disponibiliza somente a criação de wallet. Consulta de wallet, paginação do ledger, processamento das operações de aposta, outbox e workers ainda permanecem como `TODO` no `IMPLEMENTATION_PLAN.md`.
