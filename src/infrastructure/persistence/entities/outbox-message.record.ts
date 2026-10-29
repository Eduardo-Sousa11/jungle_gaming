import { defineEntity, p } from '@mikro-orm/postgresql';

const OutboxMessageRecordSchema = defineEntity({
  name: 'OutboxMessageRecord',
  tableName: 'outbox_messages',
  properties: {
    id: p.uuid().primary(),
    aggregateId: p.uuid().fieldName('aggregate_id'),
    eventType: p.string().length(100).fieldName('event_type'),
    eventVersion: p.integer().fieldName('event_version'),
    payload: p.json<Readonly<Record<string, unknown>>>(),
    occurredAt: p.datetime().columnType('timestamptz').fieldName('occurred_at'),
    attempts: p.integer(),
    nextAttemptAt: p
      .datetime()
      .columnType('timestamptz')
      .fieldName('next_attempt_at')
      .nullable(),
    publishedAt: p
      .datetime()
      .columnType('timestamptz')
      .fieldName('published_at')
      .nullable(),
    lockedAt: p
      .datetime()
      .columnType('timestamptz')
      .fieldName('locked_at')
      .nullable(),
    lockedBy: p.string().length(255).fieldName('locked_by').nullable(),
    lastErrorCode: p
      .string()
      .length(100)
      .fieldName('last_error_code')
      .nullable(),
  },
});

export class OutboxMessageRecord extends OutboxMessageRecordSchema.class {}
OutboxMessageRecordSchema.setClass(OutboxMessageRecord);
