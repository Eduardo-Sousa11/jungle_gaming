import type { MoneyProps } from '../../../domain/shared/money/money';

export const WALLET_RECONCILIATION_MONITOR = Symbol(
  'WALLET_RECONCILIATION_MONITOR',
);

export interface WalletReconciliationDivergence {
  readonly walletId: string;
  readonly storedBalance: MoneyProps;
  readonly calculatedBalance: MoneyProps;
  readonly difference: MoneyProps;
  readonly checkedEntries: number;
}

export interface WalletReconciliationMonitor {
  recordDivergence(divergence: WalletReconciliationDivergence): void;
}
