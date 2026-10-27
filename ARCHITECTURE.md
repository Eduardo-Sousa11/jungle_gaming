# Architecture

## Boundaries

The service follows four dependency-oriented areas:

- **Domain** contains value objects, entities and financial invariants. It has no NestJS, ORM, database or AWS imports.
- **Application** will contain use cases and ports. HTTP and SQS will invoke the same wagering use case.
- **Infrastructure** owns MikroORM, PostgreSQL, SQS, migrations, workers and operational adapters.
- **Presentation** owns HTTP contracts, validation and error mapping.

This is a modular monolith. Multiple stateless instances will share PostgreSQL and SQS; distributed microservices would add failure modes without improving the challenge's financial guarantees.

## Money

Money enters and leaves the system as an exact decimal string with two places. `decimal.js` performs arithmetic and PostgreSQL stores amounts as `NUMERIC(20, 2)`. JavaScript `number` is never used for monetary representation.

`Money.from` rejects negative external inputs, scientific notation, non-canonical scale, unsupported ISO-4217 currencies and values that exceed database precision. Internal arithmetic may produce a negative `Money`, which is required for operations such as reconciliation differences and `negate()`.

## Database guarantees

The initial schema establishes the five required tables:

- `wallets`;
- `wager_transactions`;
- `wallet_ledger_entries`;
- `inbox_messages`;
- `outbox_messages`.

PostgreSQL enforces non-negative wallet balances, idempotency uniqueness, provider transaction uniqueness, ledger arithmetic and one ledger entry per wallet/transaction. A trigger rejects every ledger `UPDATE` and `DELETE`.

The transaction record includes a response snapshot so an idempotent replay can return the original observed result rather than a later wallet balance.

## Planned concurrency and delivery semantics

The application will acquire a pessimistic row lock on the affected wallet. Locks will be acquired in stable wallet-ID order when an operation ever spans more than one lock. There will be no global financial lock.

Financial changes, ledger, inbox and outbox will commit in one PostgreSQL transaction. Outbox delivery will be at-least-once: concurrent publishers will claim due rows with a lease/`SKIP LOCKED`; a crash after publication but before marking the row can duplicate an event, so event IDs and consumers must be idempotent.

SQS FIFO grouping is an optimization. PostgreSQL constraints and locks remain the source of correctness.

## Authentication decision

Authentication is omitted from the three-day implementation priority because the official challenge assigns it no points. Health endpoints remain public and SQS is treated as an internal channel. The HTTP layer will retain a guard extension point for an external OIDC provider such as Keycloak; no password system will be built locally.

## Current limitations

This foundation stage does not yet expose wallet or transaction endpoints, run workers, or process financial operations. Those capabilities remain explicitly `TODO` in `IMPLEMENTATION_PLAN.md`.
