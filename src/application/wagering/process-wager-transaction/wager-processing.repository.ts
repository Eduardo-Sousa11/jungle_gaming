import type { WagerTransaction } from '../../../domain/wagering/wager-transaction';
import type { WalletLedgerEntry } from '../../../domain/wallet/wallet-ledger-entry';
import type { Wallet } from '../../../domain/wallet/wallet';
import type {
  WagerTransactionKind,
  WagerTransactionFailureCode,
  WagerTransactionStatus,
} from '../../../domain/wagering/wager-transaction';
import type { MoneyProps } from '../../../domain/shared/money/money';

export const WAGER_PROCESSING_REPOSITORY = Symbol(
  'WAGER_PROCESSING_REPOSITORY',
);

export interface WagerResponseSnapshot {
  readonly transactionId: string;
  readonly status: WagerTransactionStatus;
  readonly balance: MoneyProps;
  readonly failureCode?: WagerTransactionFailureCode;
}

export interface StoredWagerTransaction {
  readonly id: string;
  readonly providerId: string;
  readonly externalTransactionId: string;
  readonly idempotencyKey: string;
  readonly payloadHash: string;
  readonly responseSnapshot: WagerResponseSnapshot;
}

export interface SaveWagerProcessingResult {
  readonly transaction: WagerTransaction;
  readonly wallet: Wallet;
  readonly ledgerEntry?: WalletLedgerEntry;
  readonly responseSnapshot: WagerResponseSnapshot;
  readonly persistedAt: Date;
}

export interface WagerProcessingSession {
  findByIdempotencyKey(
    providerId: string,
    idempotencyKey: string,
  ): Promise<StoredWagerTransaction | undefined>;
  findByExternalTransactionId(
    providerId: string,
    externalTransactionId: string,
  ): Promise<StoredWagerTransaction | undefined>;
  lockWallet(walletId: string): Promise<Wallet | undefined>;
  findReference(
    providerId: string,
    externalTransactionId: string,
  ): Promise<WagerTransaction | undefined>;
  hasProcessedReversal(
    referenceTransactionId: string,
    kind: WagerTransactionKind,
  ): Promise<boolean>;
  save(result: SaveWagerProcessingResult): Promise<void>;
}

export interface WagerProcessingRepository {
  transactional<T>(
    work: (session: WagerProcessingSession) => Promise<T>,
  ): Promise<T>;
}
