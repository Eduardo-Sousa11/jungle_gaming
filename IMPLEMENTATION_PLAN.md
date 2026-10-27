# Implementation plan

Status values: `TODO`, `IN_PROGRESS`, `DONE`, `BLOCKED`.

## Day 1 — Foundation and financial core

| Task | Priority | Status | Acceptance criteria |
|---|---|---|---|
| Bun, NestJS and strict TypeScript setup | Critical | DONE | Build and type checking pass |
| PostgreSQL and LocalStack Compose services | Critical | DONE | Both containers become healthy |
| MikroORM and reversible initial migration | Critical | DONE | Migration up/down/up succeeds |
| Framework-independent `Money` | Eliminatory | DONE | Exact decimal unit tests pass |
| Wallet and opening ledger entry | Critical | TODO | Creation is atomic and version starts at 1 |
| Wager transaction state machine | Critical | TODO | Invalid terminal transitions fail |
| BET, WIN, LOSS, REFUND and ROLLBACK | Eliminatory | TODO | Operation matrix tests pass |
| Persistent idempotency and wallet locking | Eliminatory | TODO | Duplicate/race tests pass |

## Day 2 — API, messaging and resilience

| Task | Priority | Status | Acceptance criteria |
|---|---|---|---|
| Required HTTP endpoints | High | TODO | Contract tests pass |
| Ledger cursor and reconciliation | High | TODO | Stable pagination and exact reconstruction |
| SQS consumer and transactional inbox | Critical | TODO | Redelivery does not duplicate effects |
| Transactional outbox publisher | Eliminatory | TODO | Post-commit crash does not lose events |
| Pending-reference worker | Critical | TODO | Out-of-order references are resolved |
| Retry, DLQ and graceful shutdown | High | TODO | Failure-path integration tests pass |
| Structured logs, metrics and health | High | TODO | Required signals are exposed |

## Day 3 — Distributed validation and delivery

| Task | Priority | Status | Acceptance criteria |
|---|---|---|---|
| PostgreSQL/LocalStack integration suite | Eliminatory | TODO | Tests use real containers |
| Fifty concurrent duplicate requests | Eliminatory | TODO | Exactly one financial effect |
| Same-wallet insufficient-funds race | Eliminatory | TODO | One processed, one rejected, balance 20.00 |
| Three application instances | Eliminatory | TODO | Distributed consistency holds |
| Consumer and publisher crash recovery | Critical | TODO | Restart converges without lost effects |
| Final reconciliation audit | Critical | TODO | Every wallet equals reconstructed ledger |
| README and ARCHITECTURE documentation | High | TODO | Setup, decisions and limitations documented |
| Technical demonstration script | Medium | TODO | Main scenarios are reproducible |

## Current stage risks

- Host Bun is unavailable, so all Bun commands are executed with the pinned Docker image.
- GitHub publishing requires an authenticated GitHub integration or CLI session.
- Integration tests must avoid timing assumptions and use explicit readiness checks.

## Validation log

### Foundation stage — 2026-10-26

- `bun run typecheck`: passed.
- `bun run build`: passed.
- `bun test`: 20 passed, 0 failed.
- Migration cycle `up -> down -> up`: passed against PostgreSQL 17.
- Negative wallet balance constraint: verified against PostgreSQL.
- Ledger mutation trigger: verified against PostgreSQL.
- PostgreSQL and LocalStack/SQS health: passed.
- `GET /health/live` and `GET /health/ready`: HTTP 200.
