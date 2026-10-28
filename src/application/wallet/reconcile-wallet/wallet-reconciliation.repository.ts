export const WALLET_RECONCILIATION_REPOSITORY = Symbol(
  'WALLET_RECONCILIATION_REPOSITORY',
);

export interface WalletReconciliationSnapshot {
  readonly walletId: string;
  readonly currency: string;
  readonly storedBalance: string;
  readonly totalCredits: string;
  readonly totalDebits: string;
  readonly checkedEntries: number;
}

export interface WalletReconciliationRepository {
  getSnapshot(
    walletId: string,
  ): Promise<WalletReconciliationSnapshot | undefined>;
}
