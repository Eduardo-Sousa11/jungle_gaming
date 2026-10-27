# Jungle Gaming — Processador Distribuído de Apostas

Backend desenvolvido para o desafio técnico da Jungle Gaming. O projeto está sendo entregue em etapas pequenas e validadas. A versão atual contém a fundação da aplicação, a infraestrutura, o esquema financeiro inicial, o objeto de valor `Money` e a criação atômica de wallets.

## Etapa atual

Implementado:

- Bun 1.4.4, NestJS 12 e TypeScript 6 em modo estrito;
- PostgreSQL 17 e LocalStack Community com SQS no Docker Compose;
- fila FIFO de transações e fila FIFO de mensagens mortas (DLQ);
- configuração do MikroORM e migração inicial reversível;
- restrições de banco para saldo não negativo, unicidade e imutabilidade do ledger;
- `Money` independente de framework e com aritmética decimal exata;
- criação de wallet com transação interna `OPENING` e lançamento no ledger;
- endpoints de liveness e readiness.

O processamento de BET, WIN, LOSS, REFUND e ROLLBACK ainda não faz parte da versão atual. Consulte `IMPLEMENTATION_PLAN.md` para acompanhar a sequência de implementação.

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
