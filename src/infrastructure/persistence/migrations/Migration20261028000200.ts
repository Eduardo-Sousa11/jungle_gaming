import { Migration } from '@mikro-orm/migrations';

export class Migration20261028000200 extends Migration {
  override async up(): Promise<void> {
    this.applyPortugueseLedgerMutationMessage();
  }

  override async down(): Promise<void> {
    this.applyPortugueseLedgerMutationMessage();
  }

  private applyPortugueseLedgerMutationMessage(): void {
    this.addSql(`
      create or replace function "reject_ledger_mutation"()
      returns trigger
      language plpgsql
      as $$
      begin
        raise exception 'os lançamentos do ledger da carteira são imutáveis';
      end;
      $$;
    `);
  }
}
