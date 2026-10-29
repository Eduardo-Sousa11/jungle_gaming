import { LockMode } from '@mikro-orm/core';
import {
  EntityManager,
  UniqueConstraintViolationException,
} from '@mikro-orm/postgresql';
import { Injectable } from '@nestjs/common';

import { Money } from '../../../domain/shared/money/money';
import {
  WagerTransaction,
  WagerTransactionFailureCode,
  WagerTransactionKind,
  WagerTransactionStatus,
} from '../../../domain/wagering/wager-transaction';
import { Wallet } from '../../../domain/wallet/wallet';
import { InboxMessage } from '../../../domain/messaging/inbox-message';
import { WagerPersistenceRaceError } from '../../../application/wagering/process-wager-transaction/process-wager-transaction.errors';
import type {
  SaveWagerProcessingResult,
  StoredWagerTransaction,
  WagerProcessingRepository,
  WagerProcessingSession,
  WagerResponseSnapshot,
} from '../../../application/wagering/process-wager-transaction/wager-processing.repository';
import { WalletLedgerEntryRecord } from '../entities/wallet-ledger-entry.record';
import { WalletRecord } from '../entities/wallet.record';
import { WagerTransactionRecord } from '../entities/wager-transaction.record';
import { InboxMessageRecord } from '../entities/inbox-message.record';
import { OutboxMessageRecord } from '../entities/outbox-message.record';

const PERSISTENCE_RACE_CONSTRAINTS = [
  'wager_transactions_provider_idempotency_unique',
  'wager_transactions_provider_external_unique',
  'wager_transactions_processed_reversal_unique',
  'inbox_messages_pkey',
] as const;

@Injectable()
export class MikroOrmWagerProcessingRepository
  implements WagerProcessingRepository
{
  constructor(private readonly entityManager: EntityManager) {}

  async transactional<T>(
    work: (session: WagerProcessingSession) => Promise<T>,
  ): Promise<T> {
    try {
      return await this.entityManager.transactional(async (transactionalEm) =>
        work(new MikroOrmWagerProcessingSession(transactionalEm)),
      );
    } catch (error) {
      if (
        error instanceof UniqueConstraintViolationException &&
        PERSISTENCE_RACE_CONSTRAINTS.some((constraint) =>
          error.message.includes(constraint),
        )
      ) {
        throw new WagerPersistenceRaceError();
      }

      throw error;
    }
  }
}

class MikroOrmWagerProcessingSession implements WagerProcessingSession {
  private readonly lockedWalletRecords = new Map<string, WalletRecord>();
  private readonly inboxRecords = new Map<string, InboxMessageRecord>();

  constructor(private readonly entityManager: EntityManager) {}

  async findInboxMessage(
    consumerName: string,
    messageId: string,
  ): Promise<InboxMessage | undefined> {
    const record = await this.entityManager.findOne(InboxMessageRecord, {
      consumerName,
      messageId,
    });
    if (record === null) {
      return undefined;
    }
    this.inboxRecords.set(`${consumerName}\0${messageId}`, record);
    return InboxMessage.rehydrate({
      consumerName: record.consumerName,
      messageId: record.messageId,
      payloadHash: record.payloadHash,
      receivedAt: record.receivedAt,
      processedAt: record.processedAt ?? undefined,
    });
  }

  async saveInboxMessage(message: InboxMessage): Promise<void> {
    const key = `${message.consumerName}\0${message.messageId}`;
    let record = this.inboxRecords.get(key);
    if (record === undefined) {
      record = this.entityManager.create(InboxMessageRecord, {
        consumerName: message.consumerName,
        messageId: message.messageId,
        payloadHash: message.payloadHash,
        receivedAt: message.receivedAt,
        processedAt: message.processedAt ?? null,
      });
      this.inboxRecords.set(key, record);
      this.entityManager.persist(record);
    } else {
      record.processedAt = message.processedAt ?? null;
    }
    await this.entityManager.flush();
  }

  async findByIdempotencyKey(
    providerId: string,
    idempotencyKey: string,
  ): Promise<StoredWagerTransaction | undefined> {
    const record = await this.entityManager.findOne(WagerTransactionRecord, {
      providerId,
      idempotencyKey,
    });
    return record === null ? undefined : this.toStoredTransaction(record);
  }

  async findByExternalTransactionId(
    providerId: string,
    externalTransactionId: string,
  ): Promise<StoredWagerTransaction | undefined> {
    const record = await this.entityManager.findOne(WagerTransactionRecord, {
      providerId,
      externalTransactionId,
    });
    return record === null ? undefined : this.toStoredTransaction(record);
  }

  async lockWallet(walletId: string): Promise<Wallet | undefined> {
    const record = await this.entityManager.findOne(
      WalletRecord,
      { id: walletId },
      { lockMode: LockMode.PESSIMISTIC_WRITE },
    );
    if (record === null) {
      return undefined;
    }

    this.lockedWalletRecords.set(record.id, record);
    return Wallet.rehydrate({
      id: record.id,
      playerId: record.playerId,
      currency: record.currency,
      balance: Money.from({ amount: record.balance, currency: record.currency }),
      version: record.version,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    });
  }

  async findReference(
    providerId: string,
    externalTransactionId: string,
  ): Promise<WagerTransaction | undefined> {
    const record = await this.entityManager.findOne(WagerTransactionRecord, {
      providerId,
      externalTransactionId,
    });
    return record === null ? undefined : this.toDomainTransaction(record);
  }

  async hasProcessedReversal(
    referenceTransactionId: string,
    kind: WagerTransactionKind,
  ): Promise<boolean> {
    return (
      (await this.entityManager.count(WagerTransactionRecord, {
        referenceTransactionId,
        kind,
        status: WagerTransactionStatus.Processed,
      })) > 0
    );
  }

  async save(result: SaveWagerProcessingResult): Promise<void> {
    const { transaction } = result;
    const transactionRecord = this.entityManager.create(WagerTransactionRecord, {
      id: transaction.id,
      providerId: transaction.providerId,
      externalTransactionId: transaction.externalTransactionId,
      idempotencyKey: transaction.idempotencyKey,
      payloadHash: transaction.payloadHash,
      walletId: transaction.walletId,
      playerId: transaction.playerId,
      roundId: transaction.roundId,
      gameId: transaction.gameId,
      kind: transaction.kind,
      amount: transaction.money.toJSON().amount,
      currency: transaction.money.currency,
      referenceExternalTransactionId:
        transaction.referenceExternalTransactionId ?? null,
      referenceTransactionId: transaction.referenceTransactionId ?? null,
      status: transaction.status,
      failureCode: transaction.failureCode ?? null,
      resultBalance: result.responseSnapshot.balance.amount,
      responseSnapshot: { ...result.responseSnapshot },
      pendingReferenceAttempts: 0,
      nextReferenceAttemptAt:
        transaction.status === WagerTransactionStatus.PendingReference
          ? result.persistedAt
          : null,
      processedAt: transaction.processedAt ?? null,
      createdAt: transaction.createdAt,
      updatedAt: result.persistedAt,
    });

    this.entityManager.persist(transactionRecord);
    // As FKs são mapeadas como IDs escalares; o flush explícito preserva a ordem.
    await this.entityManager.flush();

    if (result.ledgerEntry !== undefined) {
      const walletRecord = this.lockedWalletRecords.get(result.wallet.id);
      if (walletRecord === undefined) {
        throw new Error(
          'Não é possível persistir uma carteira que não foi bloqueada nesta sessão',
        );
      }

      walletRecord.balance = result.wallet.balance.toJSON().amount;
      walletRecord.version = result.wallet.version;
      walletRecord.updatedAt = result.wallet.updatedAt;

      const ledgerEntry = result.ledgerEntry;
      const ledgerRecord = this.entityManager.create(WalletLedgerEntryRecord, {
        id: ledgerEntry.id,
        walletId: ledgerEntry.walletId,
        transactionId: ledgerEntry.transactionId,
        direction: ledgerEntry.direction,
        amount: ledgerEntry.money.toJSON().amount,
        currency: ledgerEntry.money.currency,
        balanceBefore: ledgerEntry.balanceBefore.toJSON().amount,
        balanceAfter: ledgerEntry.balanceAfter.toJSON().amount,
        createdAt: ledgerEntry.createdAt,
      });
      this.entityManager.persist(ledgerRecord);
    }

    for (const event of result.events) {
      const payload = event.toJSON();
      this.entityManager.persist(
        this.entityManager.create(OutboxMessageRecord, {
          id: event.eventId,
          aggregateId: event.aggregateId,
          eventType: event.eventType,
          eventVersion: event.version,
          payload: { ...payload },
          occurredAt: event.occurredAt,
          attempts: 0,
          nextAttemptAt: event.occurredAt,
          publishedAt: null,
          lockedAt: null,
          lockedBy: null,
          lastErrorCode: null,
        }),
      );
    }
    await this.entityManager.flush();
  }

  private toStoredTransaction(
    record: WagerTransactionRecord,
  ): StoredWagerTransaction {
    return Object.freeze({
      id: record.id,
      providerId: record.providerId,
      externalTransactionId: record.externalTransactionId,
      idempotencyKey: record.idempotencyKey,
      payloadHash: record.payloadHash,
      responseSnapshot: this.toResponseSnapshot(record.responseSnapshot),
    });
  }

  private toDomainTransaction(
    record: WagerTransactionRecord,
  ): WagerTransaction {
    return WagerTransaction.rehydrate({
      id: record.id,
      providerId: record.providerId,
      externalTransactionId: record.externalTransactionId,
      idempotencyKey: record.idempotencyKey,
      payloadHash: record.payloadHash,
      walletId: record.walletId,
      playerId: record.playerId,
      roundId: record.roundId,
      gameId: record.gameId,
      kind: record.kind as WagerTransactionKind,
      money: Money.from({ amount: record.amount, currency: record.currency }),
      referenceExternalTransactionId:
        record.referenceExternalTransactionId ?? undefined,
      status: record.status as WagerTransactionStatus,
      referenceTransactionId: record.referenceTransactionId ?? undefined,
      failureCode:
        (record.failureCode as WagerTransactionFailureCode | null) ?? undefined,
      createdAt: record.createdAt,
      processedAt: record.processedAt ?? undefined,
    });
  }

  private toResponseSnapshot(
    value: Readonly<Record<string, unknown>> | null | undefined,
  ): WagerResponseSnapshot {
    if (value === null || value === undefined) {
      throw new Error('A transação de aposta persistida não possui snapshot de resposta');
    }

    const balance = value['balance'];
    const transactionId = value['transactionId'];
    const status = value['status'];
    const failureCode = value['failureCode'];
    if (
      typeof transactionId !== 'string' ||
      typeof status !== 'string' ||
      !Object.values(WagerTransactionStatus).includes(
        status as WagerTransactionStatus,
      ) ||
      typeof balance !== 'object' ||
      balance === null ||
      !('amount' in balance) ||
      !('currency' in balance) ||
      typeof balance.amount !== 'string' ||
      typeof balance.currency !== 'string' ||
      (failureCode !== undefined &&
        (typeof failureCode !== 'string' ||
          !Object.values(WagerTransactionFailureCode).includes(
            failureCode as WagerTransactionFailureCode,
          )))
    ) {
      throw new Error('O snapshot de resposta da aposta persistida é inválido');
    }

    const normalizedBalance = Money.from({
      amount: balance.amount,
      currency: balance.currency,
    }).toJSON();

    return Object.freeze({
      transactionId,
      status: status as WagerTransactionStatus,
      balance: normalizedBalance,
      ...(failureCode === undefined
        ? {}
        : { failureCode: failureCode as WagerTransactionFailureCode }),
    });
  }
}
