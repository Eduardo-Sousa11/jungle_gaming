import type { MoneyProps } from '../../../domain/shared/money/money';
import type {
  WagerTransactionFailureCode,
  WagerTransactionKind,
  WagerTransactionStatus,
} from '../../../domain/wagering/wager-transaction';

export const WAGER_TRANSACTION_QUERY_REPOSITORY = Symbol(
  'WAGER_TRANSACTION_QUERY_REPOSITORY',
);

export interface WagerTransactionView {
  readonly transactionId: string;
  readonly providerId: string;
  readonly externalTransactionId: string;
  readonly idempotencyKey: string;
  readonly walletId: string;
  readonly playerId: string;
  readonly roundId: string;
  readonly gameId: string;
  readonly kind: WagerTransactionKind;
  readonly money: MoneyProps;
  readonly referenceExternalTransactionId?: string;
  readonly referenceTransactionId?: string;
  readonly status: WagerTransactionStatus;
  readonly failureCode?: WagerTransactionFailureCode;
  readonly resultBalance?: MoneyProps;
  readonly createdAt: string;
  readonly processedAt?: string;
}

export interface WagerTransactionQueryRepository {
  findById(transactionId: string): Promise<WagerTransactionView | undefined>;
  findByProviderAndExternalId(
    providerId: string,
    externalTransactionId: string,
  ): Promise<WagerTransactionView | undefined>;
}
