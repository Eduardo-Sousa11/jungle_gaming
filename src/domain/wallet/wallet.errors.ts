export class InvalidWalletError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidWalletError';
  }
}

export class NonPositiveWalletMovementError extends Error {
  constructor() {
    super('As movimentações da carteira devem ser maiores que zero');
    this.name = 'NonPositiveWalletMovementError';
  }
}

export class InsufficientWalletBalanceError extends Error {
  constructor() {
    super('O saldo da carteira é insuficiente para este débito');
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
    super(`Já existe uma carteira para o jogador ${playerId} e a moeda ${currency}`);
    this.name = 'WalletAlreadyExistsError';
  }
}
