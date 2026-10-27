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
| Implementar máquina de estados da transação | Crítica | TODO | Transições terminais inválidas são impedidas |
| Implementar BET, WIN, LOSS, REFUND e ROLLBACK | Eliminatória | TODO | Testes da matriz de operações aprovados |
| Implementar idempotência persistente e lock da wallet | Eliminatória | TODO | Testes de duplicação e corrida aprovados |

## API, mensageria e resiliência

| Tarefa | Prioridade | Status | Critério de aceite |
|---|---|---|---|
| Implementar endpoints HTTP obrigatórios | Alta | TODO | Testes de contrato aprovados |
| Implementar cursor do ledger e reconciliação | Alta | TODO | Paginação estável e reconstrução exata |
| Implementar consumer SQS e inbox transacional | Crítica | TODO | Redelivery não duplica efeitos |
| Implementar publisher da outbox transacional | Eliminatória | TODO | Falha após o commit não perde eventos |
| Implementar worker de referências pendentes | Crítica | TODO | Referências fora de ordem são resolvidas |
| Implementar retry, DLQ e graceful shutdown | Alta | TODO | Testes de integração dos fluxos de falha aprovados |
| Implementar logs estruturados, métricas e health | Alta | TODO | Sinais obrigatórios disponibilizados |

## Validação distribuída e entrega

| Tarefa | Prioridade | Status | Critério de aceite |
|---|---|---|---|
| Criar suíte de integração com PostgreSQL/LocalStack | Eliminatória | TODO | Testes utilizam containers reais |
| Testar cinquenta requisições duplicadas concorrentes | Eliminatória | TODO | Exatamente um efeito financeiro |
| Testar corrida de saldo insuficiente na mesma wallet | Eliminatória | TODO | Uma processada, uma rejeitada e saldo 20,00 |
| Testar três instâncias da aplicação | Eliminatória | TODO | Consistência distribuída preservada |
| Testar recuperação de falhas do consumer e publisher | Crítica | TODO | Reinicialização converge sem perder efeitos |
| Executar auditoria final de reconciliação | Crítica | TODO | Toda wallet equivale ao ledger reconstruído |
| Finalizar documentação README e ARCHITECTURE | Alta | TODO | Setup, decisões e limitações documentados |
| Criar roteiro de demonstração técnica | Média | TODO | Cenários principais são reproduzíveis |

## Riscos da etapa atual

- O Bun não está instalado no host; por isso, todos os comandos Bun utilizam a imagem Docker com versão fixada.
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
