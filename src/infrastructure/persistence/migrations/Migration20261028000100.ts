import { Migration } from '@mikro-orm/migrations';

export class Migration20261028000100 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      alter table "wager_transactions"
        drop constraint "wager_transactions_idempotency_key_unique";
    `);
    this.addSql(`
      alter table "wager_transactions"
        add constraint "wager_transactions_provider_idempotency_unique"
        unique ("provider_id", "idempotency_key");
    `);
  }

  override async down(): Promise<void> {
    this.addSql(`
      alter table "wager_transactions"
        drop constraint "wager_transactions_provider_idempotency_unique";
    `);
    this.addSql(`
      alter table "wager_transactions"
        add constraint "wager_transactions_idempotency_key_unique"
        unique ("idempotency_key");
    `);
  }
}
