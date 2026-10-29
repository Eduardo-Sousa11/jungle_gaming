export interface InboxMessageState {
  readonly messageId: string;
  readonly consumerName: string;
  readonly payloadHash: string;
  readonly receivedAt: Date;
  readonly processedAt?: Date;
}

export class InboxMessage {
  private constructor(
    public readonly messageId: string,
    public readonly consumerName: string,
    public readonly payloadHash: string,
    private readonly _receivedAt: Date,
    private _processedAt?: Date,
  ) {}

  static receive(props: Omit<InboxMessageState, 'processedAt'>): InboxMessage {
    InboxMessage.assertState(props);
    return new InboxMessage(
      props.messageId,
      props.consumerName,
      props.payloadHash,
      new Date(props.receivedAt),
    );
  }

  static rehydrate(state: InboxMessageState): InboxMessage {
    InboxMessage.assertState(state);
    return new InboxMessage(
      state.messageId,
      state.consumerName,
      state.payloadHash,
      new Date(state.receivedAt),
      state.processedAt === undefined
        ? undefined
        : new Date(state.processedAt),
    );
  }

  get receivedAt(): Date {
    return new Date(this._receivedAt);
  }

  get processedAt(): Date | undefined {
    return this._processedAt === undefined
      ? undefined
      : new Date(this._processedAt);
  }

  isProcessed(): boolean {
    return this._processedAt !== undefined;
  }

  markProcessed(at: Date): void {
    if (this._processedAt !== undefined) {
      return;
    }
    if (Number.isNaN(at.getTime())) {
      throw new Error('Inbox processed date is invalid');
    }
    this._processedAt = new Date(at);
  }

  matchesPayload(payloadHash: string): boolean {
    return this.payloadHash === payloadHash;
  }

  private static assertState(state: {
    readonly messageId: string;
    readonly consumerName: string;
    readonly payloadHash: string;
    readonly receivedAt: Date;
  }): void {
    if (
      state.messageId.trim().length === 0 ||
      state.consumerName.trim().length === 0 ||
      !/^[0-9a-f]{64}$/.test(state.payloadHash) ||
      Number.isNaN(state.receivedAt.getTime())
    ) {
      throw new Error('Inbox message state is invalid');
    }
  }
}
