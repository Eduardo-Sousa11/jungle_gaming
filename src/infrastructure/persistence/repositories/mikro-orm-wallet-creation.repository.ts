import {
  EntityManager,
  UniqueConstraintViolationException,
} from '@mikro-orm/postgresql';
import { Injectable } from '@nestjs/common';

import type {
  CreateWalletAggregate,
  WalletCreationRepository,
} from '../../../application/wallet/create-wallet/wallet-creation.repository';
import { WalletAlreadyExistsError } from '../../../domain/wallet/wallet.errors';
import { WalletLedgerEntryRecord } from '../entities/wallet-ledger-entry.record';
import { WalletRecord } from '../entities/wallet.record';
import { WagerTransactionRecord } from '../entities/wager-transaction.record';

@Injectable()
export class MikroOrmWalletCreationRepository
  implements WalletCreationRepository
{
  constructor(private readonly entityManager: EntityManager) {}

  async create(aggregate: CreateWalletAggregate): Promise<void> {
    try {
      await this.entityManager.transactional(async (transactionalEntityManager) => {
        const wallet = aggregate.wallet;
        const walletRecord = transactionalEntityManager.create(WalletRecord, {
          id: wallet.id,
          playerId: wallet.playerId,
          currency: wallet.currency,
          balance: wallet.balance.toJSON().amount,
          version: wallet.version,
          createdAt: wallet.createdAt,
          updatedAt: wallet.updatedAt,
        });

        transactionalEntityManager.persist(walletRecord);
        await transactionalEntityManager.flush();

        const opening = aggregate.openingTransaction;
        if (opening !== undefined) {
          const openingRecord = transactionalEntityManager.create(
            WagerTransactionRecord,
            {
              id: opening.id,
              providerId: opening.providerId,
              externalTransactionId: opening.externalTransactionId,
              idempotencyKey: opening.idempotencyKey,
              payloadHash: opening.payloadHash,
              walletId: opening.walletId,
              playerId: opening.playerId,
              roundId: opening.roundId,
              gameId: opening.gameId,
              kind: opening.kind,
              amount: opening.money.toJSON().amount,
              currency: opening.money.currency,
              referenceExternalTransactionId: null,
              referenceTransactionId: null,
              status: opening.status,
              failureCode: null,
              resultBalance: opening.money.toJSON().amount,
              responseSnapshot: {
                balance: opening.money.toJSON(),
                idempotentReplay: false,
                status: opening.status,
                transactionId: opening.id,
              },
              pendingReferenceAttempts: 0,
              nextReferenceAttemptAt: null,
              processedAt: opening.processedAt ?? null,
              createdAt: opening.createdAt,
              updatedAt: opening.processedAt ?? opening.createdAt,
            },
          );

          transactionalEntityManager.persist(openingRecord);
          await transactionalEntityManager.flush();
        }

        const ledgerEntry = aggregate.ledgerEntry;
        if (ledgerEntry !== undefined) {
          const ledgerRecord = transactionalEntityManager.create(
            WalletLedgerEntryRecord,
            {
              id: ledgerEntry.id,
              walletId: ledgerEntry.walletId,
              transactionId: ledgerEntry.transactionId,
              direction: ledgerEntry.direction,
              amount: ledgerEntry.money.toJSON().amount,
              currency: ledgerEntry.money.currency,
              balanceBefore: ledgerEntry.balanceBefore.toJSON().amount,
              balanceAfter: ledgerEntry.balanceAfter.toJSON().amount,
              createdAt: ledgerEntry.createdAt,
            },
          );

          transactionalEntityManager.persist(ledgerRecord);
          await transactionalEntityManager.flush();
        }
      });
    } catch (error) {
      if (
        error instanceof UniqueConstraintViolationException &&
        error.message.includes('wallets_player_currency_unique')
      ) {
        throw new WalletAlreadyExistsError(
          aggregate.wallet.playerId,
          aggregate.wallet.currency,
        );
      }

      throw error;
    }
  }
}
