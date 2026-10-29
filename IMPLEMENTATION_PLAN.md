# Plano de implementação

Valores permitidos para status: `TODO`, `IN_PROGRESS`, `DONE`, `BLOCKED`.

## Fundação e núcleo financeiro

| Tarefa | Prioridade | Status | Critério de aceite |
|---|---|---|---|
| Configurar Bun, NestJS e TypeScript strict | Crítica | DONE | Build e verificação de tipos aprovados |
| Configurar PostgreSQL e LocalStack no Compose | Crítica | DONE | Ambos os containers ficam saudáveis |
| Configurar MikroORM e migração inicial reversível | Crítica | DONE | Ciclo de migração up/down/up aprovado |
| Implementar `Money` independente de framework | Eliminatória | DONE | Testes unitários de precisão decimal aprovados |
| Implementar Wallet e lançamento de abertura | Crítica | DONE | Criação atômica e versão iniciada em 1 |
| Implementar máquina de estados da transação | Crítica | DONE | Transições terminais inválidas são impedidas |
| Implementar BET, WIN, LOSS, REFUND e ROLLBACK | Eliminatória | DONE | Testes da matriz de operações aprovados |
| Implementar idempotência persistente e lock da wallet | Eliminatória | DONE | Testes de duplicação e corrida aprovados |

## API, mensageria e resiliência

| Tarefa | Prioridade | Status | Critério de aceite |
|---|---|---|---|
| Implementar endpoints HTTP de submissão e consulta | Alta | DONE | Testes de contrato aprovados |
| Implementar cursor do ledger e reconciliação | Alta | DONE | Paginação estável e reconstrução exata |
| Implementar consumer SQS e inbox transacional | Crítica | DONE | Redelivery não duplica efeitos |
| Implementar publisher da outbox transacional | Eliminatória | DONE | Falha após o commit não perde eventos |
| Implementar worker de referências pendentes | Crítica | DONE | Referências fora de ordem são resolvidas |
| Implementar retry, DLQ e graceful shutdown | Alta | DONE | Testes de integração dos fluxos de falha aprovados |
| Implementar logs estruturados, métricas e health | Alta | DONE | Sinais obrigatórios disponibilizados |

## Validação distribuída e entrega

| Tarefa | Prioridade | Status | Critério de aceite |
|---|---|---|---|
| Criar suíte de integração com PostgreSQL/LocalStack | Eliminatória | DONE | Testes utilizam containers reais |
| Testar cinquenta requisições duplicadas concorrentes | Eliminatória | DONE | Exatamente um efeito financeiro |
| Testar corrida de saldo insuficiente na mesma wallet | Eliminatória | DONE | Uma processada, uma rejeitada e saldo 20,00 |
| Testar três instâncias da aplicação | Eliminatória | DONE | Consistência distribuída preservada |
| Testar recuperação de falhas do consumer e publisher | Crítica | DONE | Reinicialização converge sem perder efeitos |
| Executar auditoria final de reconciliação | Crítica | DONE | Toda wallet equivale ao ledger reconstruído |
| Finalizar documentação README e ARCHITECTURE | Alta | DONE | Setup, decisões e limitações documentados |
| Criar roteiro de demonstração técnica | Média | DONE | Cenários principais são reproduzíveis |

## Riscos da etapa atual

- O Bun não está instalado no host; por isso, os comandos utilizam a imagem Docker ou execução efêmera da versão fixada 1.4.4.
- Testes de integração devem evitar suposições de tempo e utilizar verificações explícitas de prontidão.

## Registro de validação

### Etapa de fundação — 26/10/2026

- `bun run typecheck`: aprovado.
- `bun run build`: aprovado.
- `bun test`: 20 aprovados e 0 falhas.
- Ciclo de migração `up -> down -> up`: aprovado no PostgreSQL 17.
- Constraint de saldo não negativo da wallet: verificada no PostgreSQL.
- Trigger de imutabilidade do ledger: verificado no PostgreSQL.
- Saúde do PostgreSQL e LocalStack/SQS: aprovada.
- `GET /health/live` e `GET /health/ready`: HTTP 200.

### Wallet e lançamento de abertura — 27/10/2026

- `bun run typecheck`: aprovado.
- `bun run build`: aprovado.
- `bun test`: 37 aprovados e 0 falhas.
- `bun run test:integration`: 4 aprovados e 0 falhas no PostgreSQL real.
- Wallet com saldo positivo: wallet, `OPENING` e ledger persistidos atomicamente.
- Wallet com saldo zero: nenhuma transação e nenhum lançamento gerados.
- Falha no insert do ledger: wallet e `OPENING` revertidos por rollback.
- Duplicidade de jogador/moeda: HTTP 409 e código `WALLET_ALREADY_EXISTS`.
- Payload inválido: HTTP 400.
- Reconstrução pelo ledger: saldo armazenado `100.00`, saldo calculado `100.00`.

### Máquina de estados da transação — 27/10/2026

- `npx --yes bun@1.4.4 run check`: aprovado, com 81 testes e 0 falhas.
- `npx --yes bun@1.4.4 run build`: aprovado.
- Factory externa: transações iniciam em `PENDING` e `OPENING` externo é rejeitado.
- Estados terminais `PROCESSED`, `REJECTED` e `FAILED`: novas transições impedidas.
- `PENDING_REFERENCE`: somente transações com referência declarada podem aguardar resolução.
- `REFUND` e `ROLLBACK`: referência obrigatória e compatibilidade de contexto e valor validada.
- Direções do ledger: BET débito, WIN/REFUND crédito, LOSS sem lançamento e ROLLBACK invertido.

### Matriz financeira das operações — 28/10/2026

- `npx --yes bun@1.4.4 run check`: aprovado, com 111 testes e 0 falhas.
- `npx --yes bun@1.4.4 run build`: aprovado.
- BET: débito processado com ledger e rejeição sem efeito para saldo insuficiente.
- WIN: crédito com referência opcional a BET.
- LOSS: processada sem alteração de saldo, versão ou ledger.
- REFUND: crédito integral de uma BET processada.
- ROLLBACK: inversão de BET, WIN ou REFUND, com código distinto quando o débito produziria saldo negativo.
- Referência ausente: `PENDING_REFERENCE`; referência inválida ou repetida: `REJECTED` sem efeito financeiro.
- Contexto financeiro: wallet, jogador, moeda, provedor, rodada, tipo, estado e valor da referência validados.

### Idempotência persistente e lock por wallet — 28/10/2026

- `npx --yes bun@1.4.4 run check`: aprovado, com 122 testes e 0 falhas.
- `npx --yes bun@1.4.4 run build`: aprovado.
- `bun run test:integration`: 11 aprovados e 0 falhas no PostgreSQL 17 real.
- Migration de idempotência por provedor: ciclo `up -> down -> up` aprovado.
- Cinquenta requisições duplicadas concorrentes: uma transação, um débito e 49 replays.
- Duas BETs concorrentes de `80.00` sobre saldo `100.00`: uma processada, uma rejeitada, saldo final `20.00` e um único débito.
- Duas devoluções concorrentes da mesma BET: uma processada e uma rejeitada como `REFERENCE_ALREADY_REVERSED`.
- Replay após movimentos posteriores: devolvido o saldo original armazenado no snapshot.
- Falha ao persistir ledger: insert da transação e atualização da wallet revertidos integralmente.
- Lock pessimista isolado na wallet; nenhuma trava financeira global utilizada.

### API HTTP de submissão e consulta — 28/10/2026

- `npx --yes bun@1.4.4 run check`: aprovado, com 122 testes e 0 falhas.
- `npx --yes bun@1.4.4 run build`: aprovado.
- `bun run test:integration`: 18 aprovados e 0 falhas no PostgreSQL 17 real.
- `POST /wagering/transactions`: processamento, replay, conflito, rejeição e referência pendente validados por HTTP real.
- `GET /wallets/:walletId`: saldo, versão e datas persistidas retornados.
- `GET /wagering/transactions/:transactionId`: consulta pelo identificador interno.
- `GET /providers/:providerId/wagering/transactions/:externalTransactionId`: consulta pela identidade do provedor.
- Validação automática: envelope `VALIDATION_ERROR`; `Idempotency-Key` ausente: `IDEMPOTENCY_KEY_REQUIRED`.
- Status distintos para payload inválido, ausência, conflito, pendência, rejeição e indisponibilidade.

### Paginação do ledger e reconciliação — 28/10/2026

- `npx --yes bun@1.4.4 run check`: aprovado, com 136 testes e 0 falhas.
- `npx --yes bun@1.4.4 run build`: aprovado.
- `npx --yes bun@1.4.4 run test:integration`: 21 aprovados e 0 falhas no PostgreSQL 17 real.
- `GET /wallets/:walletId/ledger`: limite padrão 50, máximo 100 e ordenação determinística por data e identificador.
- Cursor Base64URL opaco, versionado, validado e vinculado à wallet; cursor inválido retorna `INVALID_LEDGER_CURSOR`.
- Keyset pagination verificada com novo lançamento inserido entre páginas, sem deslocar ou repetir os lançamentos anteriores.
- `POST /wallets/:walletId/reconciliation`: saldo calculado exatamente por créditos menos débitos e quantidade de lançamentos verificados.
- Divergência financeira: sinalizada na resposta, registrada pelo monitor e não corrigida silenciosamente.

### Mensageria, resiliência e entrega final — 28/10/2026

- `npx --yes bun@1.4.4 run check`: aprovado, com 138 testes e 0 falhas.
- `npx --yes bun@1.4.4 run build`: aprovado.
- `npx --yes bun@1.4.4 run test:integration`: 30 aprovados, 0 falhas e 629 asserções com PostgreSQL 17 e LocalStack reais.
- Consumer SQS: inbox, efeito financeiro, ledger e outbox confirmados na mesma transação; ACK somente após commit.
- Crash após commit e antes do ACK: redelivery retornou replay sem novo débito ou novo lançamento.
- Outbox: publishers concorrentes com `SKIP LOCKED`, lease expirado recuperado e todos os eventos confirmados.
- Referência fora de ordem: REFUND pendente convergiu após a BET; referência ausente expirou em rejeição auditável.
- Retry e DLQ: mensagem inválida chegou à DLQ real após o limite configurado de entregas.
- Três instâncias independentes: somente uma BET de `60.00` foi processada sobre saldo `100.00`; saldo final `40.00`.
- Auditoria final: todas as wallets persistidas equivalem ao saldo reconstruído pelo ledger.
- Observabilidade: logs JSON, métricas Prometheus, liveness e readiness validados no Compose.
- Graceful shutdown: container encerrou em 2 segundos e voltou a ficar pronto após reinício.
- Documentos finais: README, arquitetura, matriz de rastreabilidade e roteiro de demonstração em português.
