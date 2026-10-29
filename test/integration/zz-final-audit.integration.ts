import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { MikroORM } from '@mikro-orm/postgresql';

import mikroOrmConfig from '../../src/infrastructure/persistence/mikro-orm.config';

interface AuditRow {
  readonly wallet_id: string;
  readonly stored_balance: string;
  readonly calculated_balance: string;
  readonly ledger_entries: number;
}

describe('Auditoria financeira final', () => {
  let orm: MikroORM;

  beforeAll(async () => {
    orm = await MikroORM.init(mikroOrmConfig);
    await orm.migrator.up();
  });

  afterAll(async () => {
    await orm.close(true);
  });

  test('toda carteira persistida equivale ao ledger completo reconstruído', async () => {
    const rows = await orm.em.getConnection().execute<AuditRow[]>(`
      select
        wallet."id" as "wallet_id",
        wallet."balance"::text as "stored_balance",
        coalesce(
          sum(
            case ledger."direction"
              when 'CREDIT' then ledger."amount"
              when 'DEBIT' then -ledger."amount"
            end
          ),
          0
        )::text as "calculated_balance",
        count(ledger."id")::integer as "ledger_entries"
      from "wallets" as wallet
      left join "wallet_ledger_entries" as ledger
        on ledger."wallet_id" = wallet."id"
      group by wallet."id", wallet."balance"
      order by wallet."id"
    `);

    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.stored_balance).toBe(normalize(row.calculated_balance));
      expect(row.ledger_entries).toBeGreaterThanOrEqual(0);
    }
  });
});

function normalize(value: string): string {
  return value.includes('.') ? value : `${value}.00`;
}
