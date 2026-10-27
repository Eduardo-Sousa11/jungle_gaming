import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';

import { MikroORM } from '@mikro-orm/postgresql';

import type { IdGenerator } from '../../src/application/shared/id-generator.port';
import { CreateWalletUseCase } from '../../src/application/wallet/create-wallet/create-wallet.use-case';
import { WalletAlreadyExistsError } from '../../src/domain/wallet/wallet.errors';
import { WalletLedgerEntryRecord } from '../../src/infrastructure/persistence/entities/wallet-ledger-entry.record';
import { WalletRecord } from '../../src/infrastructure/persistence/entities/wallet.record';
import { WagerTransactionRecord } from '../../src/infrastructure/persistence/entities/wager-transaction.record';
import mikroOrmConfig from '../../src/infrastructure/persistence/mikro-orm.config';
import { MikroOrmWalletCreationRepository } from '../../src/infrastructure/persistence/repositories/mikro-orm-wallet-creation.repository';
import { Sha256PayloadHasher } from '../../src/infrastructure/shared/sha256-payload-hasher';
import { SystemClock } from '../../src/infrastructure/shared/system-clock';
import { UuidGenerator } from '../../src/infrastructure/shared/uuid-generator';

class SequenceIdGenerator implements IdGenerator {
  private cursor = 0;

  constructor(private readonly ids: readonly string[]) {}

  generate(): string {
    const id = this.ids[this.cursor];
    if (id === undefined) {
      throw new Error('No identifier configured for this integration test');
    }
    this.cursor += 1;
    return id;
  }
}

describe('CreateWalletUseCase with PostgreSQL', () => {
  let orm: MikroORM;

  beforeAll(async () => {
    orm = await MikroORM.init(mikroOrmConfig);
    await orm.migrator.up();
  });

  afterAll(async () => {
    await orm.close(true);
  });

  test('persists wallet, OPENING and ledger atomically', async () => {
    const useCase = createUseCase(new UuidGenerator());
    const playerId = randomUUID();

    const output = await useCase.execute({
      playerId,
      initialBalance: { amount: '100.00', currency: 'BRL' },
    });

    const entityManager = orm.em.fork();
    const wallet = await entityManager.findOneOrFail(WalletRecord, {
      id: output.id,
    });
    const opening = await entityManager.findOneOrFail(WagerTransactionRecord, {
      walletId: output.id,
    });
    const ledger = await entityManager.findOneOrFail(WalletLedgerEntryRecord, {
      walletId: output.id,
    });

    expect(wallet.balance).toBe('100.00');
    expect(wallet.version).toBe(1);
    expect(opening.kind).toBe('OPENING');
    expect(opening.status).toBe('PROCESSED');
    expect(ledger.direction).toBe('CREDIT');
    expect(ledger.balanceBefore).toBe('0.00');
    expect(ledger.balanceAfter).toBe('100.00');
  });

  test('persists only the wallet when its initial balance is zero', async () => {
    const useCase = createUseCase(new UuidGenerator());

    const output = await useCase.execute({
      playerId: randomUUID(),
      initialBalance: { amount: '0.00', currency: 'BRL' },
    });

    const entityManager = orm.em.fork();
    const wallet = await entityManager.findOneOrFail(WalletRecord, {
      id: output.id,
    });
    const transactionCount = await entityManager.count(WagerTransactionRecord, {
      walletId: output.id,
    });
    const ledgerCount = await entityManager.count(WalletLedgerEntryRecord, {
      walletId: output.id,
    });

    expect(wallet.balance).toBe('0.00');
    expect(transactionCount).toBe(0);
    expect(ledgerCount).toBe(0);
  });

  test('maps the player and currency uniqueness constraint to a domain conflict', async () => {
    const playerId = randomUUID();
    const useCase = createUseCase(new UuidGenerator());
    await useCase.execute({
      playerId,
      initialBalance: { amount: '0.00', currency: 'BRL' },
    });

    await expect(
      createUseCase(new UuidGenerator()).execute({
        playerId,
        initialBalance: { amount: '0.00', currency: 'BRL' },
      }),
    ).rejects.toBeInstanceOf(WalletAlreadyExistsError);
  });

  test('rolls back wallet and OPENING when the ledger insert fails', async () => {
    const existingLedgerId = randomUUID();
    await createUseCase(
      new SequenceIdGenerator([randomUUID(), randomUUID(), existingLedgerId]),
    ).execute({
      playerId: randomUUID(),
      initialBalance: { amount: '10.00', currency: 'BRL' },
    });

    const rolledBackWalletId = randomUUID();
    const rolledBackTransactionId = randomUUID();
    const failingUseCase = createUseCase(
      new SequenceIdGenerator([
        rolledBackWalletId,
        rolledBackTransactionId,
        existingLedgerId,
      ]),
    );

    await expect(
      failingUseCase.execute({
        playerId: randomUUID(),
        initialBalance: { amount: '20.00', currency: 'BRL' },
      }),
    ).rejects.toThrow();

    const entityManager = orm.em.fork();
    expect(
      await entityManager.count(WalletRecord, { id: rolledBackWalletId }),
    ).toBe(0);
    expect(
      await entityManager.count(WagerTransactionRecord, {
        id: rolledBackTransactionId,
      }),
    ).toBe(0);
  });

  function createUseCase(idGenerator: IdGenerator): CreateWalletUseCase {
    return new CreateWalletUseCase(
      new MikroOrmWalletCreationRepository(orm.em.fork()),
      idGenerator,
      new SystemClock(),
      new Sha256PayloadHasher(),
    );
  }
});
