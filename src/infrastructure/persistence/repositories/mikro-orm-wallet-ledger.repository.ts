import { EntityManager } from '@mikro-orm/postgresql';
import { Injectable } from '@nestjs/common';

import type {
  WalletLedgerEntryView,
  WalletLedgerPage,
  WalletLedgerPageQuery,
  WalletLedgerQueryRepository,
} from '../../../application/wallet/get-wallet-ledger/wallet-ledger-query.repository';
import type {
  WalletReconciliationRepository,
  WalletReconciliationSnapshot,
} from '../../../application/wallet/reconcile-wallet/wallet-reconciliation.repository';
import { Money } from '../../../domain/shared/money/money';
import { WalletMovementDirection } from '../../../domain/wallet/wallet';
import { WalletRecord } from '../entities/wallet.record';

interface LedgerRow {
  readonly id: string;
  readonly transaction_id: string;
  readonly direction: string;
  readonly amount: string;
  readonly currency: string;
  readonly balance_before: string;
  readonly balance_after: string;
  readonly created_at: Date | string;
}

interface ReconciliationRow {
  readonly wallet_id: string;
  readonly currency: string;
  readonly stored_balance: string;
  readonly total_credits: string;
  readonly total_debits: string;
  readonly checked_entries: number;
}

@Injectable()
export class MikroOrmWalletLedgerRepository
  implements WalletLedgerQueryRepository, WalletReconciliationRepository
{
  constructor(private readonly entityManager: EntityManager) {}

  async findPage(
    query: WalletLedgerPageQuery,
  ): Promise<WalletLedgerPage | undefined> {
    const walletExists = await this.entityManager.count(WalletRecord, {
      id: query.walletId,
    });
    if (walletExists === 0) {
      return undefined;
    }

    const afterClause =
      query.after === undefined
        ? ''
        : 'and ("created_at", "id") < (?, ?)';
    const parameters: readonly unknown[] =
      query.after === undefined
        ? [query.walletId, query.limit + 1]
        : [
            query.walletId,
            query.after.createdAt,
            query.after.entryId,
            query.limit + 1,
          ];

    const rows = await this.entityManager.getConnection().execute<LedgerRow[]>(
      `
        select
          "id",
          "transaction_id",
          "direction",
          "amount"::text as "amount",
          "currency",
          "balance_before"::text as "balance_before",
          "balance_after"::text as "balance_after",
          "created_at"
        from "wallet_ledger_entries"
        where "wallet_id" = ?
          ${afterClause}
        order by "created_at" desc, "id" desc
        limit ?
      `,
      parameters,
    );

    const hasMore = rows.length > query.limit;
    const entries = rows.slice(0, query.limit).map((row) => this.toView(row));
    return Object.freeze({
      entries: Object.freeze(entries),
      hasMore,
    });
  }

  async getSnapshot(
    walletId: string,
  ): Promise<WalletReconciliationSnapshot | undefined> {
    const rows = await this.entityManager
      .getConnection()
      .execute<ReconciliationRow[]>(
        `
          select
            wallet."id" as "wallet_id",
            wallet."currency",
            wallet."balance"::text as "stored_balance",
            coalesce(
              sum(ledger."amount") filter (where ledger."direction" = 'CREDIT'),
              0
            )::text as "total_credits",
            coalesce(
              sum(ledger."amount") filter (where ledger."direction" = 'DEBIT'),
              0
            )::text as "total_debits",
            count(ledger."id")::integer as "checked_entries"
          from "wallets" as wallet
          left join "wallet_ledger_entries" as ledger
            on ledger."wallet_id" = wallet."id"
          where wallet."id" = ?
          group by wallet."id", wallet."currency", wallet."balance"
        `,
        [walletId],
      );
    const row = rows[0];
    if (row === undefined) {
      return undefined;
    }

    return Object.freeze({
      walletId: row.wallet_id,
      currency: row.currency,
      storedBalance: row.stored_balance,
      totalCredits: normalizeDatabaseDecimal(row.total_credits),
      totalDebits: normalizeDatabaseDecimal(row.total_debits),
      checkedEntries: row.checked_entries,
    });
  }

  private toView(row: LedgerRow): WalletLedgerEntryView {
    const currency = row.currency;
    return Object.freeze({
      id: row.id,
      transactionId: row.transaction_id,
      direction: row.direction as WalletMovementDirection,
      money: Money.from({ amount: row.amount, currency }).toJSON(),
      balanceBefore: Money.from({
        amount: row.balance_before,
        currency,
      }).toJSON(),
      balanceAfter: Money.from({
        amount: row.balance_after,
        currency,
      }).toJSON(),
      createdAt: new Date(row.created_at).toISOString(),
    });
  }
}

function normalizeDatabaseDecimal(value: string): string {
  return value.includes('.') ? value : `${value}.00`;
}
