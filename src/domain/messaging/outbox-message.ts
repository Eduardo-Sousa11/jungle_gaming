import type { SerializedIntegrationEvent } from './integration-event';

export interface OutboxMessageState {
  readonly id: string;
  readonly aggregateId: string;
  readonly eventType: string;
  readonly eventVersion: number;
  readonly payload: SerializedIntegrationEvent<object>;
  readonly occurredAt: Date;
  readonly attempts: number;
  readonly nextAttemptAt?: Date;
  readonly publishedAt?: Date;
}

export class OutboxMessage {
  private constructor(
    public readonly id: string,
    public readonly aggregateId: string,
    public readonly eventType: string,
    public readonly eventVersion: number,
    public readonly payload: SerializedIntegrationEvent<object>,
    private readonly _occurredAt: Date,
    private _attempts: number,
    private _nextAttemptAt?: Date,
    private _publishedAt?: Date,
  ) {}

  static rehydrate(state: OutboxMessageState): OutboxMessage {
    return new OutboxMessage(
      state.id,
      state.aggregateId,
      state.eventType,
      state.eventVersion,
      state.payload,
      new Date(state.occurredAt),
      state.attempts,
      state.nextAttemptAt === undefined
        ? undefined
        : new Date(state.nextAttemptAt),
      state.publishedAt === undefined ? undefined : new Date(state.publishedAt),
    );
  }

  get occurredAt(): Date {
    return new Date(this._occurredAt);
  }

  get attempts(): number {
    return this._attempts;
  }

  get nextAttemptAt(): Date | undefined {
    return this._nextAttemptAt === undefined
      ? undefined
      : new Date(this._nextAttemptAt);
  }

  get publishedAt(): Date | undefined {
    return this._publishedAt === undefined
      ? undefined
      : new Date(this._publishedAt);
  }

  isPending(): boolean {
    return this._publishedAt === undefined;
  }

  isDue(now: Date): boolean {
    return (
      this.isPending() &&
      (this._nextAttemptAt === undefined || this._nextAttemptAt <= now)
    );
  }

  markPublished(at: Date): void {
    this._publishedAt = new Date(at);
    this._nextAttemptAt = undefined;
  }

  scheduleRetry(now: Date): void {
    this._attempts += 1;
    const delaySeconds = Math.min(300, 2 ** Math.min(this._attempts, 8));
    this._nextAttemptAt = new Date(now.getTime() + delaySeconds * 1_000);
  }
}
