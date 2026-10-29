# Matriz de rastreabilidade

| ID | Requisito | Prioridade | Implementação principal | Evidência automatizada | Status |
|---|---|---|---|---|---|
| R01 | Dinheiro decimal exato, sem `number` | Eliminatória | `domain/shared/money` | `money.spec.ts` | DONE |
| R02 | Saldo não negativo e ledger imutável | Eliminatória | domínio Wallet e migration inicial | testes de domínio e integração | DONE |
| R03 | BET, WIN, LOSS, REFUND e ROLLBACK | Crítica | `WagerOperationProcessor` | matriz unitária de operações | DONE |
| R04 | Idempotência persistente | Eliminatória | constraints, hash canônico e snapshot | 50 duplicatas concorrentes | DONE |
| R05 | Concorrência por wallet | Eliminatória | lock PostgreSQL `FOR UPDATE` | corrida 80/80 e três instâncias | DONE |
| R06 | API HTTP completa | Alta | controllers de wallet e wagering | contratos HTTP reais | DONE |
| R07 | Ledger paginado por cursor | Alta | keyset `(created_at, id)` | inserção entre páginas | DONE |
| R08 | Reconciliação financeira | Crítica | `ReconcileWalletUseCase` | auditoria de todas as wallets | DONE |
| R09 | Consumer SQS e inbox | Eliminatória | handler/consumer e `inbox_messages` | crash antes do ACK e redelivery | DONE |
| R10 | Outbox transacional | Eliminatória | eventos concretos e `outbox_messages` | publishers concorrentes e lease | DONE |
| R11 | Referências fora de ordem | Crítica | worker pending reference | resolução e expiração | DONE |
| R12 | Retry, DLQ e shutdown | Alta | redrive SQS e hooks NestJS | DLQ real após cinco entregas | DONE |
| R13 | Observabilidade | Alta | logger JSON, `/metrics`, health | contrato HTTP de métricas | DONE |
| R14 | PostgreSQL e LocalStack reais | Eliminatória | Docker Compose | suíte `test:integration` | DONE |
| R15 | Documentação e demonstração | Alta | README, arquitetura e demo | revisão de entrega | DONE |
