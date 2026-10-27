# Jungle Gaming — Distributed Wagering Processor

Backend for the Jungle Gaming technical challenge. The project is being delivered in small, validated stages; the current version contains the application foundation, infrastructure, initial financial schema and exact `Money` value object.

## Current stage

Implemented:

- Bun 1.4.4, NestJS 12 and strict TypeScript 6;
- PostgreSQL 17 and LocalStack Community with SQS in Docker Compose;
- FIFO transaction queue and FIFO dead-letter queue;
- MikroORM configuration and reversible initial migration;
- database constraints for non-negative balances, uniqueness and ledger immutability;
- framework-independent `Money` with exact decimal arithmetic;
- liveness and readiness endpoints.

Wallet and wagering use cases are intentionally not part of this first stage yet. See `IMPLEMENTATION_PLAN.md` for the delivery sequence.

## Run with Docker

Docker is the only host prerequisite.

```bash
docker compose up --build -d
curl http://localhost:3000/health/live
curl http://localhost:3000/health/ready
```

Expected health response:

```json
{
  "status": "ok",
  "timestamp": "2026-10-27T02:12:07.954Z"
}
```

Stop the containers without deleting the persisted volumes:

```bash
docker compose down
```

## Validate

The host does not need a Bun installation. Commands use the pinned runtime image:

```bash
docker run --rm --user "$(id -u):$(id -g)" \
  -v "$PWD:/app" -w /app oven/bun:1.4.4 bun install --frozen-lockfile

docker run --rm --user "$(id -u):$(id -g)" \
  -v "$PWD:/app" -w /app oven/bun:1.4.4 bun run check

docker run --rm --user "$(id -u):$(id -g)" \
  -v "$PWD:/app" -w /app oven/bun:1.4.4 bun run build
```

## Migrations

With PostgreSQL running:

```bash
docker compose run --rm app bun run db:migrate
docker compose run --rm app bun run db:migrate:down
```

Migrations are transactional, versioned and reversible. The development Compose service applies pending migrations before accepting traffic; production deployments should run the migration command as a separate release step.

## Health contracts

- `GET /health/live`: verifies that the process can answer requests.
- `GET /health/ready`: verifies PostgreSQL and the main SQS queue.

Health endpoints are intentionally unauthenticated. Authentication has no challenge score and will remain an explicit extension point for an external OIDC provider.
