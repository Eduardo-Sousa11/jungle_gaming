export class InvalidWagerTransactionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidWagerTransactionError';
  }
}

export class InvalidTransactionStateError extends Error {
  constructor(
    public readonly transactionId: string,
    public readonly currentStatus: string,
    public readonly attemptedStatus: string,
  ) {
    super(
      `Transaction ${transactionId} cannot transition from ${currentStatus} to ${attemptedStatus}`,
    );
    this.name = 'InvalidTransactionStateError';
  }
}

export class InvalidWagerReferenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidWagerReferenceError';
  }
}
