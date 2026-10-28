import type { MoneyProps } from '../../../domain/shared/money/money';
import type { WalletMovementDirection } from '../../../domain/wallet/wallet';

export const WALLET_LEDGER_QUERY_REPOSITORY = Symbol(
  'WALLET_LEDGER_QUERY_REPOSITORY',
);

export interface WalletLedgerCursorPosition {
  readonly createdAt: Date;
  readonly entryId: string;
}

export interface WalletLedgerEntryView {
  readonly id: string;
  readonly transactionId: string;
  readonly direction: WalletMovementDirection;
  readonly money: MoneyProps;
  readonly balanceBefore: MoneyProps;
  readonly balanceAfter: MoneyProps;
  readonly createdAt: string;
}

export interface WalletLedgerPageQuery {
  readonly walletId: string;
  readonly limit: number;
  readonly after?: WalletLedgerCursorPosition;
}

export interface WalletLedgerPage {
  readonly entries: readonly WalletLedgerEntryView[];
  readonly hasMore: boolean;
}

export interface WalletLedgerQueryRepository {
  findPage(query: WalletLedgerPageQuery): Promise<WalletLedgerPage | undefined>;
}
