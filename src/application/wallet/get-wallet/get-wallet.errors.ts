export class WalletNotFoundError extends Error {
  constructor(public readonly walletId: string) {
    super(`Wallet ${walletId} was not found`);
    this.name = 'WalletNotFoundError';
  }
}
