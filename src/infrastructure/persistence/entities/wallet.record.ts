import { defineEntity, p } from '@mikro-orm/postgresql';

const WalletRecordSchema = defineEntity({
  name: 'WalletRecord',
  tableName: 'wallets',
  properties: {
    id: p.uuid().primary(),
    playerId: p.uuid().fieldName('player_id'),
    currency: p.string().columnType('char(3)'),
    balance: p.decimal('string').precision(20).scale(2),
    version: p.integer(),
    createdAt: p.datetime().columnType('timestamptz').fieldName('created_at'),
    updatedAt: p.datetime().columnType('timestamptz').fieldName('updated_at'),
  },
});

export class WalletRecord extends WalletRecordSchema.class {}
WalletRecordSchema.setClass(WalletRecord);
