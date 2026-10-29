export class WagerWalletNotFoundError extends Error {
  constructor(public readonly walletId: string) {
    super(`Wallet ${walletId} was not found`);
    this.name = 'WagerWalletNotFoundError';
  }
}

export class WagerIdempotencyConflictError extends Error {
  constructor(
    public readonly providerId: string,
    public readonly idempotencyKey: string,
  ) {
    super(
      `Idempotency key ${idempotencyKey} was already used with another payload by provider ${providerId}`,
    );
    this.name = 'WagerIdempotencyConflictError';
  }
}

export class WagerExternalTransactionConflictError extends Error {
  constructor(
    public readonly providerId: string,
    public readonly externalTransactionId: string,
  ) {
    super(
      `External transaction ${externalTransactionId} already exists for provider ${providerId}`,
    );
    this.name = 'WagerExternalTransactionConflictError';
  }
}

/** Sinaliza uma corrida vencida por outra transação no PostgreSQL. */
export class WagerPersistenceRaceError extends Error {
  constructor() {
    super('A concurrent wager transaction won a persistence uniqueness race');
    this.name = 'WagerPersistenceRaceError';
  }
}

export class InboxPayloadConflictError extends Error {
  constructor(
    public readonly consumerName: string,
    public readonly messageId: string,
  ) {
    super(
      `Inbox message ${consumerName}/${messageId} was already received with another payload`,
    );
    this.name = 'InboxPayloadConflictError';
  }
}
