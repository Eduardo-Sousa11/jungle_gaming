export class WagerTransactionNotFoundError extends Error {
  constructor() {
    super('Wager transaction was not found');
    this.name = 'WagerTransactionNotFoundError';
  }
}
