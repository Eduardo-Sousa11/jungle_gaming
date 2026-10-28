import { WalletNotFoundError } from './get-wallet.errors';
import type {
  WalletQueryRepository,
  WalletView,
} from './wallet-query.repository';

export class GetWalletUseCase {
  constructor(private readonly repository: WalletQueryRepository) {}

  async execute(walletId: string): Promise<WalletView> {
    const wallet = await this.repository.findById(walletId);
    if (wallet === undefined) {
      throw new WalletNotFoundError(walletId);
    }
    return wallet;
  }
}
