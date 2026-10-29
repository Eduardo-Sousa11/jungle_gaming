import type { WagerIntegrationEvent } from '../../../domain/messaging/wager-integration-events';
import type { WagerTransaction } from '../../../domain/wagering/wager-transaction';
import type { Wallet } from '../../../domain/wallet/wallet';
import type { WalletLedgerEntry } from '../../../domain/wallet/wallet-ledger-entry';
import type { WagerResponseSnapshot } from '../process-wager-transaction/wager-processing.repository';

export const PENDING_REFERENCE_REPOSITORY = Symbol(
  'PENDING_REFERENCE_REPOSITORY',
);

export interface PendingReferenceCandidate {
  readonly transaction: WagerTransaction;
  readonly attempts: number;
}

export interface SavePendingReferenceResolution {
  readonly transaction: WagerTransaction;
  readonly wallet: Wallet;
  readonly ledgerEntry?: WalletLedgerEntry;
  readonly responseSnapshot: WagerResponseSnapshot;
  readonly events: readonly WagerIntegrationEvent[];
  readonly attempts: number;
  readonly persistedAt: Date;
}

export interface PendingReferenceSession {
  claimNext(now: Date): Promise<PendingReferenceCandidate | undefined>;
  lockWallet(walletId: string): Promise<Wallet>;
  findReference(
    providerId: string,
    externalTransactionId: string,
  ): Promise<WagerTransaction | undefined>;
  hasProcessedReversal(
    referenceTransactionId: string,
    kind: WagerTransaction['kind'],
  ): Promise<boolean>;
  reschedule(
    transactionId: string,
    attempts: number,
    nextAttemptAt: Date,
    at: Date,
  ): Promise<void>;
  saveResolution(result: SavePendingReferenceResolution): Promise<void>;
}

export interface PendingReferenceRepository {
  transactional<T>(
    work: (session: PendingReferenceSession) => Promise<T>,
  ): Promise<T>;
}
