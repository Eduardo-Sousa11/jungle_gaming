import type { MoneyProps } from '../../../domain/shared/money/money';
import { Money } from '../../../domain/shared/money/money';
import { WalletNotFoundError } from '../get-wallet/get-wallet.errors';
import type { WalletReconciliationMonitor } from './wallet-reconciliation.monitor';
import type { WalletReconciliationRepository } from './wallet-reconciliation.repository';

export interface ReconcileWalletOutput {
  readonly walletId: string;
  readonly storedBalance: MoneyProps;
  readonly calculatedBalance: MoneyProps;
  readonly difference: MoneyProps;
  readonly consistent: boolean;
  readonly checkedEntries: number;
}

export class ReconcileWalletUseCase {
  constructor(
    private readonly repository: WalletReconciliationRepository,
    private readonly monitor: WalletReconciliationMonitor,
  ) {}

  async execute(walletId: string): Promise<ReconcileWalletOutput> {
    const snapshot = await this.repository.getSnapshot(walletId);
    if (snapshot === undefined) {
      throw new WalletNotFoundError(walletId);
    }

    const storedBalance = Money.from({
      amount: snapshot.storedBalance,
      currency: snapshot.currency,
    });
    const calculatedBalance = Money.from({
      amount: snapshot.totalCredits,
      currency: snapshot.currency,
    }).subtract(
      Money.from({
        amount: snapshot.totalDebits,
        currency: snapshot.currency,
      }),
    );
    const difference = storedBalance.subtract(calculatedBalance);
    const consistent = difference.isZero();

    const result = Object.freeze({
      walletId: snapshot.walletId,
      storedBalance: storedBalance.toJSON(),
      calculatedBalance: calculatedBalance.toJSON(),
      difference: difference.toJSON(),
      consistent,
      checkedEntries: snapshot.checkedEntries,
    });

    if (!consistent) {
      this.monitor.recordDivergence(result);
    }

    return result;
  }
}
