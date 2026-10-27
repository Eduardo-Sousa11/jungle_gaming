export class InvalidWalletError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidWalletError';
  }
}

export class NonPositiveWalletMovementError extends Error {
  constructor() {
    super('Wallet movements must be greater than zero');
    this.name = 'NonPositiveWalletMovementError';
  }
}

export class InsufficientWalletBalanceError extends Error {
  constructor() {
    super('Wallet balance is insufficient for this debit');
    this.name = 'InsufficientWalletBalanceError';
  }
}

export class InvalidLedgerEntryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidLedgerEntryError';
  }
}

export class WalletAlreadyExistsError extends Error {
  constructor(
    public readonly playerId: string,
    public readonly currency: string,
  ) {
    super(`Wallet already exists for player ${playerId} and currency ${currency}`);
    this.name = 'WalletAlreadyExistsError';
  }
}
