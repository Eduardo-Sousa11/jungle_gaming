import { EntityManager } from '@mikro-orm/postgresql';
import { Injectable } from '@nestjs/common';

import type {
  ClaimedOutboxMessage,
  OutboxRepository,
} from '../../../application/messaging/outbox/outbox.repository';

interface OutboxRow {
  readonly id: string;
  readonly aggregate_id: string;
  readonly event_type: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly occurred_at: Date | string;
  readonly attempts: number;
}

@Injectable()
export class MikroOrmOutboxRepository implements OutboxRepository {
  constructor(private readonly entityManager: EntityManager) {}

  async claimBatch(input: {
    readonly workerId: string;
    readonly now: Date;
    readonly leaseExpiresBefore: Date;
    readonly limit: number;
  }): Promise<readonly ClaimedOutboxMessage[]> {
    return this.entityManager.transactional(async (transactionalEm) => {
      const rows = await transactionalEm.getConnection().execute<OutboxRow[]>(
        `
          with candidates as (
            select "id"
            from "outbox_messages"
            where "published_at" is null
              and (
                "attempts" = 0
                or coalesce("next_attempt_at", "occurred_at") <= ?
              )
              and ("locked_at" is null or "locked_at" < ?)
            order by coalesce("next_attempt_at", "occurred_at"), "occurred_at", "id"
            for update skip locked
            limit ?
          )
          update "outbox_messages" as message
          set "locked_at" = ?, "locked_by" = ?
          from candidates
          where message."id" = candidates."id"
          returning message."id", message."aggregate_id", message."event_type",
                    message."payload", message."occurred_at", message."attempts"
        `,
        [
          input.now,
          input.leaseExpiresBefore,
          input.limit,
          input.now,
          input.workerId,
        ],
      );
      return Object.freeze(
        rows.map((row) =>
          Object.freeze({
            id: row.id,
            aggregateId: row.aggregate_id,
            eventType: row.event_type,
            payload: row.payload,
            occurredAt: new Date(row.occurred_at),
            attempts: row.attempts,
          }),
        ),
      );
    });
  }

  async markPublished(id: string, workerId: string, at: Date): Promise<void> {
    await this.entityManager.getConnection().execute(
      `
        update "outbox_messages"
        set "published_at" = ?, "locked_at" = null, "locked_by" = null,
            "last_error_code" = null
        where "id" = ? and "locked_by" = ? and "published_at" is null
      `,
      [at, id, workerId],
    );
  }

  async scheduleRetry(input: {
    readonly id: string;
    readonly workerId: string;
    readonly nextAttemptAt: Date;
    readonly errorCode: string;
  }): Promise<void> {
    await this.entityManager.getConnection().execute(
      `
        update "outbox_messages"
        set "attempts" = "attempts" + 1, "next_attempt_at" = ?,
            "locked_at" = null, "locked_by" = null, "last_error_code" = ?
        where "id" = ? and "locked_by" = ? and "published_at" is null
      `,
      [input.nextAttemptAt, input.errorCode.slice(0, 100), input.id, input.workerId],
    );
  }

  async oldestPendingOccurredAt(): Promise<Date | undefined> {
    const rows = await this.entityManager.getConnection().execute<
      Array<{ occurred_at: Date | string }>
    >(
      `
        select "occurred_at"
        from "outbox_messages"
        where "published_at" is null
        order by "occurred_at", "id"
        limit 1
      `,
    );
    return rows[0] === undefined ? undefined : new Date(rows[0].occurred_at);
  }
}
