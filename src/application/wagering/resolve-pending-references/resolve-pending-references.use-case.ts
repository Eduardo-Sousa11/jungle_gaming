import type { Clock } from '../../shared/clock.port';
import type { IdGenerator } from '../../shared/id-generator.port';
import { createWagerIntegrationEvents } from '../process-wager-transaction/wager-integration-event.factory';
import type { WagerResponseSnapshot } from '../process-wager-transaction/wager-processing.repository';
import { WagerOperationProcessor } from '../../../domain/wagering/wager-operation-processor';
import {
  WagerTransactionFailureCode,
  WagerTransactionStatus,
} from '../../../domain/wagering/wager-transaction';
import type {
  PendingReferenceRepository,
  PendingReferenceSession,
} from './pending-reference.repository';

const MAX_REFERENCE_ATTEMPTS = 8;
const MAX_REFERENCE_BACKOFF_SECONDS = 300;

export class ResolvePendingReferencesUseCase {
  constructor(
    private readonly repository: PendingReferenceRepository,
    private readonly idGenerator: IdGenerator,
    private readonly clock: Clock,
    private readonly processor: WagerOperationProcessor,
  ) {}

  async executeBatch(limit = 20): Promise<number> {
    let processed = 0;
    for (let index = 0; index < limit; index += 1) {
      const found = await this.executeOne();
      if (!found) {
        break;
      }
      processed += 1;
    }
    return processed;
  }

  async executeOne(): Promise<boolean> {
    return this.repository.transactional(async (session) => {
      const now = this.clock.now();
      const candidate = await session.claimNext(now);
      if (candidate === undefined) {
        return false;
      }

      const transaction = candidate.transaction;
      const wallet = await session.lockWallet(transaction.walletId);
      const referenceExternalId = transaction.referenceExternalTransactionId;
      if (referenceExternalId === undefined) {
        throw new Error('A transação com referência pendente não possui referência externa');
      }
      const reference = await session.findReference(
        transaction.providerId,
        referenceExternalId,
      );
      const attempts = candidate.attempts + 1;

      if (reference === undefined && attempts < MAX_REFERENCE_ATTEMPTS) {
        await session.reschedule(
          transaction.id,
          attempts,
          this.nextAttemptAt(now, attempts),
          now,
        );
        return true;
      }

      if (reference === undefined) {
        transaction.reject(WagerTransactionFailureCode.ReferenceNotFound);
        const snapshot = this.snapshot(transaction, wallet);
        await session.saveResolution({
          transaction,
          wallet,
          responseSnapshot: snapshot,
          events: createWagerIntegrationEvents({
            transaction,
            wallet,
            responseSnapshot: snapshot,
            occurredAt: now,
            context: {
              correlationId: transaction.id,
              causationId: transaction.id,
            },
          }),
          attempts,
          persistedAt: now,
        });
        return true;
      }

      const sameKindReversalExists = transaction.requiresReference()
        ? await session.hasProcessedReversal(reference.id, transaction.kind)
        : false;
      const operation = this.processor.process({
        transaction,
        wallet,
        reference,
        sameKindReversalExists,
        ledgerEntryId: transaction.affectsBalance()
          ? this.idGenerator.generate()
          : '',
        at: now,
      });
      const snapshot = this.snapshot(transaction, wallet);
      await session.saveResolution({
        transaction,
        wallet,
        ledgerEntry: operation.ledgerEntry,
        responseSnapshot: snapshot,
        events: createWagerIntegrationEvents({
          transaction,
          wallet,
          ledgerEntry: operation.ledgerEntry,
          responseSnapshot: snapshot,
          occurredAt: now,
          context: {
            correlationId: transaction.id,
            causationId: transaction.id,
          },
        }),
        attempts,
        persistedAt: now,
      });
      return true;
    });
  }

  private snapshot(
    transaction: {
      readonly id: string;
      readonly status: WagerTransactionStatus;
      readonly failureCode?: WagerTransactionFailureCode;
    },
    wallet: { readonly balance: { toJSON(): WagerResponseSnapshot['balance'] } },
  ): WagerResponseSnapshot {
    return Object.freeze({
      transactionId: transaction.id,
      status: transaction.status,
      balance: wallet.balance.toJSON(),
      ...(transaction.failureCode === undefined
        ? {}
        : { failureCode: transaction.failureCode }),
    });
  }

  private nextAttemptAt(now: Date, attempts: number): Date {
    const seconds = Math.min(
      MAX_REFERENCE_BACKOFF_SECONDS,
      5 * 2 ** Math.max(0, attempts - 1),
    );
    return new Date(now.getTime() + seconds * 1_000);
  }
}
