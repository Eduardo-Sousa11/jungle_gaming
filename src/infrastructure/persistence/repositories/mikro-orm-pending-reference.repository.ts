import { LockMode } from '@mikro-orm/core';
import { EntityManager } from '@mikro-orm/postgresql';
import { Injectable } from '@nestjs/common';

import type {
  PendingReferenceCandidate,
  PendingReferenceRepository,
  PendingReferenceSession,
  SavePendingReferenceResolution,
} from '../../../application/wagering/resolve-pending-references/pending-reference.repository';
import { Money } from '../../../domain/shared/money/money';
import {
  WagerTransaction,
  WagerTransactionFailureCode,
  WagerTransactionKind,
  WagerTransactionStatus,
} from '../../../domain/wagering/wager-transaction';
import { Wallet } from '../../../domain/wallet/wallet';
import { OutboxMessageRecord } from '../entities/outbox-message.record';
import { WalletLedgerEntryRecord } from '../entities/wallet-ledger-entry.record';
import { WalletRecord } from '../entities/wallet.record';
import { WagerTransactionRecord } from '../entities/wager-transaction.record';

@Injectable()
export class MikroOrmPendingReferenceRepository
  implements PendingReferenceRepository
{
  constructor(private readonly entityManager: EntityManager) {}

  transactional<T>(
    work: (session: PendingReferenceSession) => Promise<T>,
  ): Promise<T> {
    return this.entityManager.transactional((em) =>
      work(new MikroOrmPendingReferenceSession(em)),
    );
  }
}

class MikroOrmPendingReferenceSession implements PendingReferenceSession {
  private claimedRecord?: WagerTransactionRecord;
  private lockedWalletRecord?: WalletRecord;

  constructor(private readonly entityManager: EntityManager) {}

  async claimNext(now: Date): Promise<PendingReferenceCandidate | undefined> {
    const rows = await this.entityManager.getConnection().execute<
      Array<{ id: string }>
    >(
      `
        select "id"
        from "wager_transactions"
        where "status" = 'PENDING_REFERENCE'
          and (
            "pending_reference_attempts" = 0
            or coalesce("next_reference_attempt_at", "created_at") <= ?
          )
        order by coalesce("next_reference_attempt_at", "created_at"), "id"
        for update skip locked
        limit 1
      `,
      [now],
    );
    const id = rows[0]?.id;
    if (id === undefined) {
      return undefined;
    }
    const record = await this.entityManager.findOneOrFail(
      WagerTransactionRecord,
      { id },
    );
    this.claimedRecord = record;
    return Object.freeze({
      transaction: this.toDomain(record),
      attempts: record.pendingReferenceAttempts,
    });
  }

  async lockWallet(walletId: string): Promise<Wallet> {
    const record = await this.entityManager.findOneOrFail(
      WalletRecord,
      { id: walletId },
      { lockMode: LockMode.PESSIMISTIC_WRITE },
    );
    this.lockedWalletRecord = record;
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
    return record === null ? undefined : this.toDomain(record);
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

  async reschedule(
    transactionId: string,
    attempts: number,
    nextAttemptAt: Date,
    at: Date,
  ): Promise<void> {
    const record = this.requireClaimed(transactionId);
    record.pendingReferenceAttempts = attempts;
    record.nextReferenceAttemptAt = nextAttemptAt;
    record.updatedAt = at;
    await this.entityManager.flush();
  }

  async saveResolution(result: SavePendingReferenceResolution): Promise<void> {
    const record = this.requireClaimed(result.transaction.id);
    record.status = result.transaction.status;
    record.referenceTransactionId =
      result.transaction.referenceTransactionId ?? null;
    record.failureCode = result.transaction.failureCode ?? null;
    record.resultBalance = result.responseSnapshot.balance.amount;
    record.responseSnapshot = { ...result.responseSnapshot };
    record.pendingReferenceAttempts = result.attempts;
    record.nextReferenceAttemptAt = null;
    record.processedAt = result.transaction.processedAt ?? null;
    record.updatedAt = result.persistedAt;

    if (result.ledgerEntry !== undefined) {
      const walletRecord = this.lockedWalletRecord;
      if (walletRecord === undefined || walletRecord.id !== result.wallet.id) {
        throw new Error('A carteira da referência pendente não foi bloqueada');
      }
      walletRecord.balance = result.wallet.balance.toJSON().amount;
      walletRecord.version = result.wallet.version;
      walletRecord.updatedAt = result.wallet.updatedAt;
      const entry = result.ledgerEntry;
      this.entityManager.persist(
        this.entityManager.create(WalletLedgerEntryRecord, {
          id: entry.id,
          walletId: entry.walletId,
          transactionId: entry.transactionId,
          direction: entry.direction,
          amount: entry.money.toJSON().amount,
          currency: entry.money.currency,
          balanceBefore: entry.balanceBefore.toJSON().amount,
          balanceAfter: entry.balanceAfter.toJSON().amount,
          createdAt: entry.createdAt,
        }),
      );
    }

    for (const event of result.events) {
      this.entityManager.persist(
        this.entityManager.create(OutboxMessageRecord, {
          id: event.eventId,
          aggregateId: event.aggregateId,
          eventType: event.eventType,
          eventVersion: event.version,
          payload: { ...event.toJSON() },
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

  private requireClaimed(transactionId: string): WagerTransactionRecord {
    if (this.claimedRecord?.id !== transactionId) {
      throw new Error('A transação com referência pendente não foi reservada');
    }
    return this.claimedRecord;
  }

  private toDomain(record: WagerTransactionRecord): WagerTransaction {
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
}
