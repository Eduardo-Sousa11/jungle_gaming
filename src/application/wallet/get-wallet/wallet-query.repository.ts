import type { MoneyProps } from '../../../domain/shared/money/money';

export const WALLET_QUERY_REPOSITORY = Symbol('WALLET_QUERY_REPOSITORY');

export interface WalletView {
  readonly id: string;
  readonly playerId: string;
  readonly balance: MoneyProps;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface WalletQueryRepository {
  findById(walletId: string): Promise<WalletView | undefined>;
}
