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
      `A transação ${transactionId} não pode mudar de ${currentStatus} para ${attemptedStatus}`,
    );
    this.name = 'InvalidTransactionStateError';
  }
}

export enum WagerReferenceFailureReason {
  Missing = 'MISSING',
  ExternalTransactionMismatch = 'EXTERNAL_TRANSACTION_MISMATCH',
  SelfReference = 'SELF_REFERENCE',
  NotProcessed = 'NOT_PROCESSED',
  ProviderMismatch = 'PROVIDER_MISMATCH',
  PlayerMismatch = 'PLAYER_MISMATCH',
  WalletMismatch = 'WALLET_MISMATCH',
  RoundMismatch = 'ROUND_MISMATCH',
  CurrencyMismatch = 'CURRENCY_MISMATCH',
  AmountMismatch = 'AMOUNT_MISMATCH',
  KindNotAllowed = 'KIND_NOT_ALLOWED',
}

export class InvalidWagerReferenceError extends Error {
  constructor(
    public readonly reason: WagerReferenceFailureReason,
    message: string,
  ) {
    super(message);
    this.name = 'InvalidWagerReferenceError';
  }
}
