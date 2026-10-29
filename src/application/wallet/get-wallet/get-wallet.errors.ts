export class WalletNotFoundError extends Error {
  constructor(public readonly walletId: string) {
    super(`A carteira ${walletId} não foi encontrada`);
    this.name = 'WalletNotFoundError';
  }
}
