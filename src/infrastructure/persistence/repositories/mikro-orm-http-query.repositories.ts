import { EntityManager } from '@mikro-orm/postgresql';
import { Injectable } from '@nestjs/common';

import type {
  WagerTransactionQueryRepository,
  WagerTransactionView,
} from '../../../application/wagering/query-wager-transactions/wager-transaction-query.repository';
import type {
  WalletQueryRepository,
  WalletView,
} from '../../../application/wallet/get-wallet/wallet-query.repository';
import { Money } from '../../../domain/shared/money/money';
import {
  WagerTransactionFailureCode,
  WagerTransactionKind,
  WagerTransactionStatus,
} from '../../../domain/wagering/wager-transaction';
import { WalletRecord } from '../entities/wallet.record';
import { WagerTransactionRecord } from '../entities/wager-transaction.record';

@Injectable()
export class MikroOrmWalletQueryRepository implements WalletQueryRepository {
  constructor(private readonly entityManager: EntityManager) {}

  async findById(walletId: string): Promise<WalletView | undefined> {
    const record = await this.entityManager.findOne(WalletRecord, {
      id: walletId,
    });
    if (record === null) {
      return undefined;
    }

    return Object.freeze({
      id: record.id,
      playerId: record.playerId,
      balance: Money.from({
        amount: record.balance,
        currency: record.currency,
      }).toJSON(),
      version: record.version,
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
    });
  }
}

@Injectable()
export class MikroOrmWagerTransactionQueryRepository
  implements WagerTransactionQueryRepository
{
  constructor(private readonly entityManager: EntityManager) {}

  async findById(
    transactionId: string,
  ): Promise<WagerTransactionView | undefined> {
    const record = await this.entityManager.findOne(WagerTransactionRecord, {
      id: transactionId,
    });
    return record === null ? undefined : this.toView(record);
  }

  async findByProviderAndExternalId(
    providerId: string,
    externalTransactionId: string,
  ): Promise<WagerTransactionView | undefined> {
    const record = await this.entityManager.findOne(WagerTransactionRecord, {
      providerId,
      externalTransactionId,
    });
    return record === null ? undefined : this.toView(record);
  }

  private toView(record: WagerTransactionRecord): WagerTransactionView {
    return Object.freeze({
      transactionId: record.id,
      providerId: record.providerId,
      externalTransactionId: record.externalTransactionId,
      idempotencyKey: record.idempotencyKey,
      walletId: record.walletId,
      playerId: record.playerId,
      roundId: record.roundId,
      gameId: record.gameId,
      kind: record.kind as WagerTransactionKind,
      money: Money.from({
        amount: record.amount,
        currency: record.currency,
      }).toJSON(),
      ...(record.referenceExternalTransactionId === null ||
      record.referenceExternalTransactionId === undefined
        ? {}
        : {
            referenceExternalTransactionId:
              record.referenceExternalTransactionId,
          }),
      ...(record.referenceTransactionId === null ||
      record.referenceTransactionId === undefined
        ? {}
        : { referenceTransactionId: record.referenceTransactionId }),
      status: record.status as WagerTransactionStatus,
      ...(record.failureCode === null || record.failureCode === undefined
        ? {}
        : {
            failureCode: record.failureCode as WagerTransactionFailureCode,
          }),
      ...(record.resultBalance === null || record.resultBalance === undefined
        ? {}
        : {
            resultBalance: Money.from({
              amount: record.resultBalance,
              currency: record.currency,
            }).toJSON(),
          }),
      createdAt: record.createdAt.toISOString(),
      ...(record.processedAt === null || record.processedAt === undefined
        ? {}
        : { processedAt: record.processedAt.toISOString() }),
    });
  }
}
