export const OUTBOX_REPOSITORY = Symbol('OUTBOX_REPOSITORY');

export interface ClaimedOutboxMessage {
  readonly id: string;
  readonly aggregateId: string;
  readonly eventType: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly occurredAt: Date;
  readonly attempts: number;
}

export interface OutboxRepository {
  claimBatch(input: {
    readonly workerId: string;
    readonly now: Date;
    readonly leaseExpiresBefore: Date;
    readonly limit: number;
  }): Promise<readonly ClaimedOutboxMessage[]>;
  markPublished(id: string, workerId: string, at: Date): Promise<void>;
  scheduleRetry(input: {
    readonly id: string;
    readonly workerId: string;
    readonly nextAttemptAt: Date;
    readonly errorCode: string;
  }): Promise<void>;
  oldestPendingOccurredAt(): Promise<Date | undefined>;
}
