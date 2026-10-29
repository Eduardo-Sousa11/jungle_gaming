export class WagerTransactionNotFoundError extends Error {
  constructor() {
    super('A transação de aposta não foi encontrada');
    this.name = 'WagerTransactionNotFoundError';
  }
}
