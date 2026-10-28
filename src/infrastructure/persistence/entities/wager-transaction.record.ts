import { defineEntity, p } from '@mikro-orm/postgresql';

const WagerTransactionRecordSchema = defineEntity({
  name: 'WagerTransactionRecord',
  tableName: 'wager_transactions',
  properties: {
    id: p.uuid().primary(),
    providerId: p.string().length(100).fieldName('provider_id'),
    externalTransactionId: p
      .string()
      .length(255)
      .fieldName('external_transaction_id'),
    idempotencyKey: p.string().length(255).fieldName('idempotency_key'),
    payloadHash: p.string().columnType('char(64)').fieldName('payload_hash'),
    walletId: p.uuid().fieldName('wallet_id'),
    playerId: p.uuid().fieldName('player_id'),
    roundId: p.string().length(255).fieldName('round_id'),
    gameId: p.string().length(255).fieldName('game_id'),
    kind: p.string().length(16),
    amount: p.decimal('string').precision(20).scale(2),
    currency: p.string().columnType('char(3)'),
    referenceExternalTransactionId: p
      .string()
      .length(255)
      .fieldName('reference_external_transaction_id')
      .nullable(),
    referenceTransactionId: p
      .uuid()
      .fieldName('reference_transaction_id')
      .nullable(),
    status: p.string().length(32),
    failureCode: p.string().length(64).fieldName('failure_code').nullable(),
    resultBalance: p
      .decimal('string')
      .precision(20)
      .scale(2)
      .fieldName('result_balance')
      .nullable(),
    responseSnapshot: p
      .json<Readonly<Record<string, unknown>>>()
      .fieldName('response_snapshot')
      .nullable(),
    pendingReferenceAttempts: p
      .integer()
      .fieldName('pending_reference_attempts'),
    nextReferenceAttemptAt: p
      .datetime()
      .columnType('timestamptz')
      .fieldName('next_reference_attempt_at')
      .nullable(),
    processedAt: p
      .datetime()
      .columnType('timestamptz')
      .fieldName('processed_at')
      .nullable(),
    createdAt: p.datetime().columnType('timestamptz').fieldName('created_at'),
    updatedAt: p.datetime().columnType('timestamptz').fieldName('updated_at'),
  },
});

export class WagerTransactionRecord extends WagerTransactionRecordSchema.class {}
WagerTransactionRecordSchema.setClass(WagerTransactionRecord);
