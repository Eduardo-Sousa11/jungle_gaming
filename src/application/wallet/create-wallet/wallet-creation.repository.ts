import type { WagerTransaction } from '../../../domain/wagering/wager-transaction';
import type { WalletLedgerEntry } from '../../../domain/wallet/wallet-ledger-entry';
import type { Wallet } from '../../../domain/wallet/wallet';

export const WALLET_CREATION_REPOSITORY = Symbol(
  'WALLET_CREATION_REPOSITORY',
);

export interface CreateWalletAggregate {
  readonly wallet: Wallet;
  readonly openingTransaction?: WagerTransaction;
  readonly ledgerEntry?: WalletLedgerEntry;
}

export interface WalletCreationRepository {
  /** Persiste todo o agregado em uma única transação SQL. */
  create(aggregate: CreateWalletAggregate): Promise<void>;
}
