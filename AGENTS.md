# Engineering rules

## Source of truth

- The official challenge README is the product specification.
- Keep `IMPLEMENTATION_PLAN.md` current after each completed stage.
- Do not claim a command or test passed unless it was executed successfully.

## Non-negotiable guarantees

- Never use JavaScript `number` for monetary amounts.
- Never rely on memory or SQS FIFO as the final idempotency guarantee.
- Never publish integration events before the financial transaction commits.
- Never update or delete ledger entries.
- Never use a global lock; concurrency is isolated by wallet.
- PostgreSQL constraints must enforce uniqueness and non-negative balances.
- Domain code must not import NestJS, MikroORM, PostgreSQL, or AWS packages.

## Architecture

- `domain`: entities, value objects, domain errors and invariants.
- `application`: use cases and ports.
- `infrastructure`: PostgreSQL, MikroORM, SQS, workers and observability.
- `presentation`: HTTP controllers, DTOs and error mapping.
- Use private constructors with `create`, `from` or `rehydrate` factories.
- HTTP and SQS must call the same wagering use case.

## Commands

```bash
docker run --rm -v "$PWD:/app" -w /app oven/bun:1.4.4 bun install
docker run --rm -v "$PWD:/app" -w /app oven/bun:1.4.4 bun run check
docker compose up -d postgres localstack
docker compose run --rm app bun run db:migrate
docker compose up --build app
```

## Delivery

- Implement one traceable stage at a time.
- Run type checking and relevant tests before every commit.
- Use feature branches and merge reviewed pull requests into `main`.
- Preserve user changes and keep commits scoped to the active stage.
