# Matriz de rastreabilidade

| ID | Requisito | Prioridade | Implementação principal | Evidência automatizada | Situação |
|---|---|---|---|---|---|
| R01 | Dinheiro decimal exato, sem `number` | Eliminatória | `domain/shared/money` | `money.spec.ts` | CONCLUÍDO |
| R02 | Saldo não negativo e ledger imutável | Eliminatória | domínio Wallet e migração inicial | testes de domínio e integração | CONCLUÍDO |
| R03 | BET, WIN, LOSS, REFUND e ROLLBACK | Crítica | `WagerOperationProcessor` | matriz unitária de operações | CONCLUÍDO |
| R04 | Idempotência persistente | Eliminatória | restrições, hash canônico e snapshot | 50 duplicatas concorrentes | CONCLUÍDO |
| R05 | Concorrência por carteira | Eliminatória | bloqueio PostgreSQL `FOR UPDATE` | corrida 80/80 e três instâncias | CONCLUÍDO |
| R06 | API HTTP completa | Alta | controladores de carteira e apostas | contratos HTTP reais | CONCLUÍDO |
| R07 | Ledger paginado por cursor | Alta | conjunto de chaves `(created_at, id)` | inserção entre páginas | CONCLUÍDO |
| R08 | Reconciliação financeira | Crítica | `ReconcileWalletUseCase` | auditoria de todas as carteiras | CONCLUÍDO |
| R09 | Consumidor SQS e inbox | Eliminatória | manipulador/consumidor e `inbox_messages` | queda antes do ACK e reentrega | CONCLUÍDO |
| R10 | Outbox transacional | Eliminatória | eventos concretos e `outbox_messages` | publicadores concorrentes e concessão | CONCLUÍDO |
| R11 | Referências fora de ordem | Crítica | processo de referência pendente | resolução e expiração | CONCLUÍDO |
| R12 | Novas tentativas, DLQ e encerramento | Alta | redirecionamento SQS e gatilhos NestJS | DLQ real após cinco entregas | CONCLUÍDO |
| R13 | Observabilidade | Alta | logger JSON, `/metrics`, saúde | contrato HTTP de métricas | CONCLUÍDO |
| R14 | PostgreSQL e LocalStack reais | Eliminatória | Docker Compose | suíte `test:integration` | CONCLUÍDO |
| R15 | Documentação e demonstração | Alta | README, arquitetura e demonstração | revisão de entrega | CONCLUÍDO |
