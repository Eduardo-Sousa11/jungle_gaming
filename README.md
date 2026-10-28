# Jungle Gaming — Processador Distribuído de Apostas

Backend desenvolvido para o desafio técnico da Jungle Gaming. O projeto está sendo entregue em etapas pequenas e validadas. A versão atual contém a fundação da aplicação, a infraestrutura, o esquema financeiro, o objeto de valor `Money`, a criação atômica de wallets e o processamento transacional e idempotente das apostas.

## Etapa atual

Implementado:

- Bun 1.4.4, NestJS 12 e TypeScript 6 em modo estrito;
- PostgreSQL 17 e LocalStack Community com SQS no Docker Compose;
- fila FIFO de transações e fila FIFO de mensagens mortas (DLQ);
- configuração do MikroORM e migração inicial reversível;
- restrições de banco para saldo não negativo, unicidade e imutabilidade do ledger;
- `Money` independente de framework e com aritmética decimal exata;
- criação de wallet com transação interna `OPENING` e lançamento no ledger;
- máquina de estados de `WagerTransaction`, com estados terminais protegidos e validações de referência;
- regras de domínio de BET, WIN, LOSS, REFUND e ROLLBACK, incluindo saldo, ledger e rejeições auditáveis;
- `ProcessWagerTransactionUseCase` com hash canônico, replay persistente, lock pessimista por wallet e transação SQL atômica;
- endpoints HTTP para submissão de apostas e consultas de wallet e transação;
- endpoints de liveness e readiness.

O processamento de apostas está disponível por HTTP. A entrada SQS, inbox, outbox e publicação de eventos pertencem às próximas etapas. Consulte `IMPLEMENTATION_PLAN.md` para acompanhar a sequência de implementação.

## Execução com Docker

O único pré-requisito na máquina é o Docker.

```bash
docker compose up --build -d
curl http://localhost:3000/health/live
curl http://localhost:3000/health/ready
```

Resposta esperada dos endpoints de saúde:

```json
{
  "status": "ok",
  "timestamp": "2026-10-27T02:12:07.954Z"
}
```

Para interromper os containers sem excluir os volumes persistidos:

```bash
docker compose down
```

## Validação

Não é necessário instalar Bun na máquina. Os comandos utilizam a imagem com a versão fixada do runtime:

```bash
docker run --rm --user "$(id -u):$(id -g)" \
  -v "$PWD:/app" -w /app oven/bun:1.4.4 bun install --frozen-lockfile

docker run --rm --user "$(id -u):$(id -g)" \
  -v "$PWD:/app" -w /app oven/bun:1.4.4 bun run check

docker run --rm --user "$(id -u):$(id -g)" \
  -v "$PWD:/app" -w /app oven/bun:1.4.4 bun run build
```

Com os serviços do Compose em execução, rode os testes de integração reais:

```bash
docker compose exec app bun run test:integration
```

## Criar uma wallet

```bash
curl -X POST http://localhost:3000/wallets \
  -H 'Content-Type: application/json' \
  --data '{
    "playerId": "019a29f0-7c62-7b84-8f4a-123456789abc",
    "initialBalance": {
      "amount": "100.00",
      "currency": "BRL"
    }
  }'
```

Resposta HTTP `201`:

```json
{
  "id": "2c058153-0370-4b44-99f4-0af39361859f",
  "playerId": "019a29f0-7c62-7b84-8f4a-123456789abc",
  "balance": { "amount": "100.00", "currency": "BRL" },
  "version": 1
}
```

Quando o saldo inicial é maior que zero, wallet, transação `OPENING` e lançamento `CREDIT` são persistidos na mesma transação SQL. Saldo inicial `0.00` cria somente a wallet. Uma segunda wallet para o mesmo `playerId` e moeda retorna HTTP `409` com o código `WALLET_ALREADY_EXISTS`.

## Processamento transacional de apostas

`ProcessWagerTransactionUseCase` é o ponto central para BET, WIN, LOSS, REFUND e ROLLBACK. O caso de uso calcula SHA-256 sobre o JSON canônico dos campos de negócio, consulta a idempotência persistida, bloqueia somente a linha da wallet afetada e executa uma segunda verificação após o lock.

Wallet, transação e ledger são confirmados na mesma transação PostgreSQL. A unicidade de `(provider_id, idempotency_key)` e `(provider_id, external_transaction_id)` é garantida pelo schema. Repetições idênticas recebem o snapshot da resposta original com `idempotentReplay: true`; a mesma chave com payload diferente gera conflito.

### Submeter uma aposta

```bash
curl -X POST http://localhost:3000/wagering/transactions \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: provider-a:transaction-123' \
  --data '{
    "providerId": "provider-a",
    "externalTransactionId": "transaction-123",
    "playerId": "0192f28f-5dc0-7d58-bdb2-814ad6a0f4a1",
    "walletId": "0192f291-27dd-7d3f-8071-5f8685deef37",
    "roundId": "round-987",
    "gameId": "fortune-chimp",
    "kind": "BET",
    "money": { "amount": "25.00", "currency": "BRL" }
  }'
```

Resposta processada:

```json
{
  "transactionId": "0192f298-345e-7e38-af88-e43f851a819d",
  "status": "PROCESSED",
  "balance": { "amount": "975.00", "currency": "BRL" },
  "idempotentReplay": false
}
```

Mapeamento dos resultados:

- HTTP `200`: processada ou replay de transação processada;
- HTTP `202`: referência ainda não encontrada;
- HTTP `400`: header obrigatório ou payload inválido;
- HTTP `404`: wallet ou transação não encontrada;
- HTTP `409`: conflito de idempotência ou de transação externa;
- HTTP `422`: rejeição por regra de negócio;
- HTTP `503`: falha permanente ou esgotamento do retry de concorrência.

### Consultas disponíveis

```http
GET /wallets/:walletId
GET /wagering/transactions/:transactionId
GET /providers/:providerId/wagering/transactions/:externalTransactionId
```

Payloads inválidos utilizam o código estável `VALIDATION_ERROR`. O consumer SQS reutilizará o mesmo `ProcessWagerTransactionUseCase` da API.

## Migrações

Com o PostgreSQL em execução:

```bash
docker compose run --rm app bun run db:migrate
docker compose run --rm app bun run db:migrate:down
```

As migrações são transacionais, versionadas e reversíveis. O serviço de desenvolvimento no Compose aplica as migrações pendentes antes de aceitar requisições. Em produção, elas devem ser executadas como uma etapa separada do processo de entrega.

## Contratos de saúde

- `GET /health/live`: verifica se o processo consegue responder às requisições.
- `GET /health/ready`: verifica a conexão com o PostgreSQL e a fila SQS principal.

Os endpoints de saúde não exigem autenticação. Como autenticação não pontua no desafio, ela permanecerá como um ponto explícito de extensão para integração futura com um provedor OIDC externo.
