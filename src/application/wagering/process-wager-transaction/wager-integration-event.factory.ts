import { deterministicUuid } from '../../shared/deterministic-uuid';
import type { WagerResponseSnapshot } from './wager-processing.repository';
import type { WagerTransaction } from '../../../domain/wagering/wager-transaction';
import { WagerTransactionStatus } from '../../../domain/wagering/wager-transaction';
import type { Wallet } from '../../../domain/wallet/wallet';
import type { WalletLedgerEntry } from '../../../domain/wallet/wallet-ledger-entry';
import {
  WagerTransactionPendingReference,
  WagerTransactionProcessed,
  WagerTransactionRejected,
  WalletBalanceChanged,
  type WagerIntegrationEvent,
} from '../../../domain/messaging/wager-integration-events';

export interface WagerEventContext {
  readonly correlationId: string;
  readonly causationId?: string;
}

export function createWagerIntegrationEvents(input: {
  readonly transaction: WagerTransaction;
  readonly wallet: Wallet;
  readonly ledgerEntry?: WalletLedgerEntry;
  readonly responseSnapshot: WagerResponseSnapshot;
  readonly occurredAt: Date;
  readonly context: WagerEventContext;
}): readonly WagerIntegrationEvent[] {
  const common = {
    aggregateId: input.transaction.id,
    correlationId: input.context.correlationId,
    ...(input.context.causationId === undefined
      ? {}
      : { causationId: input.context.causationId }),
    occurredAt: input.occurredAt,
  };
  const events: WagerIntegrationEvent[] = [];

  switch (input.transaction.status) {
    case WagerTransactionStatus.Processed:
      events.push(
        WagerTransactionProcessed.create({
          ...common,
          eventId: deterministicUuid(
            input.transaction.id,
            WagerTransactionStatus.Processed,
          ),
          data: {
            transactionId: input.transaction.id,
            providerId: input.transaction.providerId,
            externalTransactionId: input.transaction.externalTransactionId,
            walletId: input.transaction.walletId,
            kind: input.transaction.kind,
            balance: input.responseSnapshot.balance,
          },
        }),
      );
      break;

    case WagerTransactionStatus.Rejected: {
      const failureCode = input.transaction.failureCode;
      if (failureCode === undefined) {
        throw new Error('A rejected transaction must have a failure code');
      }
      events.push(
        WagerTransactionRejected.create({
          ...common,
          eventId: deterministicUuid(
            input.transaction.id,
            WagerTransactionStatus.Rejected,
          ),
          data: {
            transactionId: input.transaction.id,
            providerId: input.transaction.providerId,
            externalTransactionId: input.transaction.externalTransactionId,
            walletId: input.transaction.walletId,
            kind: input.transaction.kind,
            failureCode,
            balance: input.responseSnapshot.balance,
          },
        }),
      );
      break;
    }

    case WagerTransactionStatus.PendingReference: {
      const referenceExternalTransactionId =
        input.transaction.referenceExternalTransactionId;
      if (referenceExternalTransactionId === undefined) {
        throw new Error('A pending transaction must declare its reference');
      }
      events.push(
        WagerTransactionPendingReference.create({
          ...common,
          eventId: deterministicUuid(
            input.transaction.id,
            WagerTransactionStatus.PendingReference,
          ),
          data: {
            transactionId: input.transaction.id,
            providerId: input.transaction.providerId,
            externalTransactionId: input.transaction.externalTransactionId,
            referenceExternalTransactionId,
            walletId: input.transaction.walletId,
            kind: input.transaction.kind,
          },
        }),
      );
      break;
    }

    case WagerTransactionStatus.Pending:
    case WagerTransactionStatus.Failed:
      break;
  }

  if (input.ledgerEntry !== undefined) {
    events.push(
      WalletBalanceChanged.create({
        eventId: deterministicUuid(
          input.transaction.id,
          'WalletBalanceChanged',
        ),
        aggregateId: input.wallet.id,
        correlationId: input.context.correlationId,
        ...(input.context.causationId === undefined
          ? {}
          : { causationId: input.context.causationId }),
        occurredAt: input.occurredAt,
        data: {
          walletId: input.wallet.id,
          transactionId: input.transaction.id,
          direction: input.ledgerEntry.direction,
          money: input.ledgerEntry.money.toJSON(),
          balanceBefore: input.ledgerEntry.balanceBefore.toJSON(),
          balanceAfter: input.ledgerEntry.balanceAfter.toJSON(),
          walletVersion: input.wallet.version,
        },
      }),
    );
  }

  return Object.freeze(events);
}
