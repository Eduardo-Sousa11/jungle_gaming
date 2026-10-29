import { describe, expect, test } from 'bun:test';

import { WalletNotFoundError } from '../get-wallet/get-wallet.errors';
import { ReconcileWalletUseCase } from './reconcile-wallet.use-case';
import type {
  WalletReconciliationDivergence,
  WalletReconciliationMonitor,
} from './wallet-reconciliation.monitor';
import type {
  WalletReconciliationRepository,
  WalletReconciliationSnapshot,
} from './wallet-reconciliation.repository';

class FixedReconciliationRepository implements WalletReconciliationRepository {
  constructor(private readonly snapshot?: WalletReconciliationSnapshot) {}

  async getSnapshot(): Promise<WalletReconciliationSnapshot | undefined> {
    return this.snapshot;
  }
}

class CapturingReconciliationMonitor implements WalletReconciliationMonitor {
  divergences: WalletReconciliationDivergence[] = [];

  recordDivergence(divergence: WalletReconciliationDivergence): void {
    this.divergences.push(divergence);
  }
}

describe('ReconcileWalletUseCase', () => {
  test('reconstrói o saldo a partir dos totais exatos de crédito e débito', async () => {
    const monitor = new CapturingReconciliationMonitor();
    const useCase = new ReconcileWalletUseCase(
      new FixedReconciliationRepository({
        walletId: 'wallet-1',
        currency: 'BRL',
        storedBalance: '85.00',
        totalCredits: '125.00',
        totalDebits: '40.00',
        checkedEntries: 3,
      }),
      monitor,
    );

    const result = await useCase.execute('wallet-1');

    expect(result).toEqual({
      walletId: 'wallet-1',
      storedBalance: { amount: '85.00', currency: 'BRL' },
      calculatedBalance: { amount: '85.00', currency: 'BRL' },
      difference: { amount: '0.00', currency: 'BRL' },
      consistent: true,
      checkedEntries: 3,
    });
    expect(monitor.divergences).toHaveLength(0);
  });

  test('sinaliza, mas não corrige, uma divergência financeira', async () => {
    const monitor = new CapturingReconciliationMonitor();
    const useCase = new ReconcileWalletUseCase(
      new FixedReconciliationRepository({
        walletId: 'wallet-1',
        currency: 'BRL',
        storedBalance: '90.00',
        totalCredits: '125.00',
        totalDebits: '40.00',
        checkedEntries: 3,
      }),
      monitor,
    );

    const result = await useCase.execute('wallet-1');

    expect(result.consistent).toBe(false);
    expect(result.calculatedBalance.amount).toBe('85.00');
    expect(result.difference.amount).toBe('5.00');
    expect(monitor.divergences).toEqual([result]);
  });

  test('informa uma carteira inexistente', async () => {
    const useCase = new ReconcileWalletUseCase(
      new FixedReconciliationRepository(),
      new CapturingReconciliationMonitor(),
    );

    await expect(useCase.execute('wallet-missing')).rejects.toBeInstanceOf(
      WalletNotFoundError,
    );
  });
});
