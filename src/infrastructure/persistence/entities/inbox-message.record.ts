import { defineEntity, p } from '@mikro-orm/postgresql';

const InboxMessageRecordSchema = defineEntity({
  name: 'InboxMessageRecord',
  tableName: 'inbox_messages',
  properties: {
    consumerName: p.string().length(100).fieldName('consumer_name').primary(),
    messageId: p.string().length(255).fieldName('message_id').primary(),
    payloadHash: p.string().columnType('char(64)').fieldName('payload_hash'),
    receivedAt: p.datetime().columnType('timestamptz').fieldName('received_at'),
    processedAt: p
      .datetime()
      .columnType('timestamptz')
      .fieldName('processed_at')
      .nullable(),
  },
});

export class InboxMessageRecord extends InboxMessageRecordSchema.class {}
InboxMessageRecordSchema.setClass(InboxMessageRecord);
