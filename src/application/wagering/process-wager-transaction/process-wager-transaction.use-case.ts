import type { Clock } from '../../shared/clock.port';
import type { IdGenerator } from '../../shared/id-generator.port';
import type { PayloadHasher } from '../../shared/payload-hasher.port';
import { Money, type MoneyProps } from '../../../domain/shared/money/money';
import { WagerOperationProcessor } from '../../../domain/wagering/wager-operation-processor';
import {
  WagerTransaction,
  type WagerTransactionFailureCode,
  WagerTransactionKind,
  type WagerTransactionStatus,
} from '../../../domain/wagering/wager-transaction';
import {
  InboxPayloadConflictError,
  WagerExternalTransactionConflictError,
  WagerIdempotencyConflictError,
  WagerPersistenceRaceError,
  WagerWalletNotFoundError,
} from './process-wager-transaction.errors';
import { InboxMessage } from '../../../domain/messaging/inbox-message';
import { createWagerIntegrationEvents } from './wager-integration-event.factory';
import type {
  StoredWagerTransaction,
  WagerProcessingRepository,
  WagerProcessingSession,
  WagerResponseSnapshot,
} from './wager-processing.repository';

const MAX_PERSISTENCE_ATTEMPTS = 2;

export interface ProcessWagerTransactionInput {
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
}

export interface ProcessWagerTransactionOutput {
  readonly transactionId: string;
  readonly status: WagerTransactionStatus;
  readonly balance: MoneyProps;
  readonly failureCode?: WagerTransactionFailureCode;
  readonly idempotentReplay: boolean;
}

export interface ProcessWagerTransactionContext {
  readonly correlationId?: string;
  readonly causationId?: string;
  readonly inbox?: {
    readonly consumerName: string;
    readonly messageId: string;
    readonly payloadHash: string;
    readonly receivedAt: Date;
  };
}

export class ProcessWagerTransactionUseCase {
  constructor(
    private readonly repository: WagerProcessingRepository,
    private readonly idGenerator: IdGenerator,
    private readonly clock: Clock,
    private readonly payloadHasher: PayloadHasher,
    private readonly operationProcessor: WagerOperationProcessor,
  ) {}

  async execute(
    input: ProcessWagerTransactionInput,
    context: ProcessWagerTransactionContext = {},
  ): Promise<ProcessWagerTransactionOutput> {
    const money = Money.from(input.money);
    const payloadHash = this.payloadHasher.hash({
      externalTransactionId: input.externalTransactionId,
      gameId: input.gameId,
      kind: input.kind,
      money: money.toJSON(),
      playerId: input.playerId,
      providerId: input.providerId,
      referenceExternalTransactionId:
        input.referenceExternalTransactionId ?? null,
      roundId: input.roundId,
      walletId: input.walletId,
    });

    for (let attempt = 1; attempt <= MAX_PERSISTENCE_ATTEMPTS; attempt += 1) {
      try {
        return await this.executeAttempt(input, money, payloadHash, context);
      } catch (error) {
        if (
          !(error instanceof WagerPersistenceRaceError) ||
          attempt === MAX_PERSISTENCE_ATTEMPTS
        ) {
          throw error;
        }
      }
    }

    throw new WagerPersistenceRaceError();
  }

  private async executeAttempt(
    input: ProcessWagerTransactionInput,
    money: Money,
    payloadHash: string,
    context: ProcessWagerTransactionContext,
  ): Promise<ProcessWagerTransactionOutput> {
    return this.repository.transactional(async (session) => {
      const inboxMessage = await this.prepareInbox(session, context);
      const existingResult = await this.findExistingResult(
        session,
        input,
        payloadHash,
      );
      if (existingResult !== undefined) {
        await this.completeInbox(session, inboxMessage);
        return existingResult;
      }

      const wallet = await session.lockWallet(input.walletId);
      if (wallet === undefined) {
        throw new WagerWalletNotFoundError(input.walletId);
      }

      const resultAfterLock = await this.findExistingResult(
        session,
        input,
        payloadHash,
      );
      if (resultAfterLock !== undefined) {
        await this.completeInbox(session, inboxMessage);
        return resultAfterLock;
      }

      const now = this.clock.now();
      const transaction = WagerTransaction.create({
        id: this.idGenerator.generate(),
        providerId: input.providerId,
        externalTransactionId: input.externalTransactionId,
        idempotencyKey: input.idempotencyKey,
        payloadHash,
        walletId: input.walletId,
        playerId: input.playerId,
        roundId: input.roundId,
        gameId: input.gameId,
        kind: input.kind,
        money,
        referenceExternalTransactionId:
          input.referenceExternalTransactionId,
        at: now,
      });
      const reference =
        input.referenceExternalTransactionId === undefined
          ? undefined
          : await session.findReference(
              input.providerId,
              input.referenceExternalTransactionId,
            );
      const sameKindReversalExists =
        reference !== undefined && transaction.requiresReference()
          ? await session.hasProcessedReversal(reference.id, transaction.kind)
          : false;
      const operationResult = this.operationProcessor.process({
        transaction,
        wallet,
        reference,
        sameKindReversalExists,
        ledgerEntryId: transaction.affectsBalance()
          ? this.idGenerator.generate()
          : '',
        at: now,
      });
      const responseSnapshot: WagerResponseSnapshot = Object.freeze({
        transactionId: transaction.id,
        status: operationResult.status,
        balance: wallet.balance.toJSON(),
        ...(transaction.failureCode === undefined
          ? {}
          : { failureCode: transaction.failureCode }),
      });
      const eventContext = {
        correlationId: context.correlationId ?? transaction.id,
        ...(context.causationId === undefined
          ? {}
          : { causationId: context.causationId }),
      };
      const events = createWagerIntegrationEvents({
        transaction,
        wallet,
        ledgerEntry: operationResult.ledgerEntry,
        responseSnapshot,
        occurredAt: now,
        context: eventContext,
      });

      await session.save({
        transaction,
        wallet,
        ledgerEntry: operationResult.ledgerEntry,
        responseSnapshot,
        persistedAt: now,
        events,
      });
      await this.completeInbox(session, inboxMessage);

      return this.toOutput(responseSnapshot, false);
    });
  }

  private async prepareInbox(
    session: WagerProcessingSession,
    context: ProcessWagerTransactionContext,
  ): Promise<InboxMessage | undefined> {
    const input = context.inbox;
    if (input === undefined) {
      return undefined;
    }

    const existing = await session.findInboxMessage(
      input.consumerName,
      input.messageId,
    );
    if (existing !== undefined) {
      if (!existing.matchesPayload(input.payloadHash)) {
        throw new InboxPayloadConflictError(
          input.consumerName,
          input.messageId,
        );
      }
      return existing;
    }

    const received = InboxMessage.receive(input);
    await session.saveInboxMessage(received);
    return received;
  }

  private async completeInbox(
    session: WagerProcessingSession,
    inboxMessage: InboxMessage | undefined,
  ): Promise<void> {
    if (inboxMessage === undefined || inboxMessage.isProcessed()) {
      return;
    }
    inboxMessage.markProcessed(this.clock.now());
    await session.saveInboxMessage(inboxMessage);
  }

  private async findExistingResult(
    session: WagerProcessingSession,
    input: ProcessWagerTransactionInput,
    payloadHash: string,
  ): Promise<ProcessWagerTransactionOutput | undefined> {
    const byIdempotencyKey = await session.findByIdempotencyKey(
      input.providerId,
      input.idempotencyKey,
    );
    if (byIdempotencyKey !== undefined) {
      return this.replay(byIdempotencyKey, input, payloadHash);
    }

    const byExternalTransactionId =
      await session.findByExternalTransactionId(
        input.providerId,
        input.externalTransactionId,
      );
    if (byExternalTransactionId !== undefined) {
      if (byExternalTransactionId.idempotencyKey === input.idempotencyKey) {
        return this.replay(byExternalTransactionId, input, payloadHash);
      }

      throw new WagerExternalTransactionConflictError(
        input.providerId,
        input.externalTransactionId,
      );
    }

    return undefined;
  }

  private replay(
    stored: StoredWagerTransaction,
    input: ProcessWagerTransactionInput,
    payloadHash: string,
  ): ProcessWagerTransactionOutput {
    if (stored.payloadHash !== payloadHash) {
      throw new WagerIdempotencyConflictError(
        input.providerId,
        input.idempotencyKey,
      );
    }

    return this.toOutput(stored.responseSnapshot, true);
  }

  private toOutput(
    snapshot: WagerResponseSnapshot,
    idempotentReplay: boolean,
  ): ProcessWagerTransactionOutput {
    return Object.freeze({
      ...snapshot,
      idempotentReplay,
    });
  }
}
