import { Injectable, Logger } from '@nestjs/common';

import type {
  WalletReconciliationDivergence,
  WalletReconciliationMonitor,
} from '../../application/wallet/reconcile-wallet/wallet-reconciliation.monitor';
import { MetricsRegistry } from './metrics.registry';

@Injectable()
export class NestWalletReconciliationMonitor
  implements WalletReconciliationMonitor
{
  private readonly logger = new Logger(NestWalletReconciliationMonitor.name);
  private divergenceTotal = 0;

  constructor(private readonly metrics: MetricsRegistry) {}

  recordDivergence(divergence: WalletReconciliationDivergence): void {
    this.divergenceTotal += 1;
    this.metrics.increment('reconciliation_divergences_total');
    this.logger.warn({
      event: 'wallet_reconciliation_divergence',
      walletId: divergence.walletId,
      checkedEntries: divergence.checkedEntries,
      reconciliationDivergenceTotal: this.divergenceTotal,
    });
  }

  get recordedDivergences(): number {
    return this.divergenceTotal;
  }
}
