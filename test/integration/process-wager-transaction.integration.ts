import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { MikroORM } from '@mikro-orm/postgresql';

import type { IdGenerator } from '../../src/application/shared/id-generator.port';
import {
  type ProcessWagerTransactionInput,
  ProcessWagerTransactionUseCase,
} from '../../src/application/wagering/process-wager-transaction/process-wager-transaction.use-case';
import { WagerIdempotencyConflictError } from '../../src/application/wagering/process-wager-transaction/process-wager-transaction.errors';
import { CreateWalletUseCase } from '../../src/application/wallet/create-wallet/create-wallet.use-case';
import { WagerOperationProcessor } from '../../src/domain/wagering/wager-operation-processor';
import {
  WagerTransactionFailureCode,
  WagerTransactionKind,
  WagerTransactionStatus,
} from '../../src/domain/wagering/wager-transaction';
import { WalletLedgerEntryRecord } from '../../src/infrastructure/persistence/entities/wallet-ledger-entry.record';
import { WalletRecord } from '../../src/infrastructure/persistence/entities/wallet.record';
import { WagerTransactionRecord } from '../../src/infrastructure/persistence/entities/wager-transaction.record';
import mikroOrmConfig from '../../src/infrastructure/persistence/mikro-orm.config';
import { MikroOrmWagerProcessingRepository } from '../../src/infrastructure/persistence/repositories/mikro-orm-wager-processing.repository';
import { MikroOrmWalletCreationRepository } from '../../src/infrastructure/persistence/repositories/mikro-orm-wallet-creation.repository';
import { Sha256PayloadHasher } from '../../src/infrastructure/shared/sha256-payload-hasher';
import { SystemClock } from '../../src/infrastructure/shared/system-clock';
import { UuidGenerator } from '../../src/infrastructure/shared/uuid-generator';

describe('ProcessWagerTransactionUseCase com PostgreSQL', () => {
  let orm: MikroORM;

  beforeAll(async () => {
    orm = await MikroORM.init(mikroOrmConfig);
    await orm.migrator.up();
  });

  afterAll(async () => {
    await orm.close(true);
  });

  test('aplica exatamente um débito para cinquenta duplicatas concorrentes', async () => {
    const context = await createWallet('100.00');
    const input = wagerInput(context, {
      externalTransactionId: randomUUID(),
      idempotencyKey: randomUUID(),
      money: { amount: '25.00', currency: 'BRL' },
    });

    const outputs = await Promise.all(
      Array.from({ length: 50 }, () => createWagerUseCase().execute(input)),
    );
    const transactionIds = new Set(
      outputs.map((output) => output.transactionId),
    );

    expect(transactionIds.size).toBe(1);
    expect(
      outputs.filter((output) => !output.idempotentReplay),
    ).toHaveLength(1);
    expect(outputs.filter((output) => output.idempotentReplay)).toHaveLength(49);
    expect(outputs.every((output) => output.balance.amount === '75.00')).toBe(
      true,
    );

    const entityManager = orm.em.fork();
    const wallet = await entityManager.findOneOrFail(WalletRecord, {
      id: context.walletId,
    });
    expect(wallet.balance).toBe('75.00');
    expect(wallet.version).toBe(2);
    expect(
      await entityManager.count(WagerTransactionRecord, {
        providerId: input.providerId,
        externalTransactionId: input.externalTransactionId,
      }),
    ).toBe(1);
    expect(
      await entityManager.count(WalletLedgerEntryRecord, {
        walletId: context.walletId,
      }),
    ).toBe(2);
  });

  test('serializa duas apostas concorrentes que disputam o mesmo saldo', async () => {
    const context = await createWallet('100.00');
    const firstInput = wagerInput(context, {
      externalTransactionId: randomUUID(),
      idempotencyKey: randomUUID(),
      money: { amount: '80.00', currency: 'BRL' },
    });
    const secondInput = wagerInput(context, {
      externalTransactionId: randomUUID(),
      idempotencyKey: randomUUID(),
      money: { amount: '80.00', currency: 'BRL' },
    });

    const outputs = await Promise.all([
      createWagerUseCase().execute(firstInput),
      createWagerUseCase().execute(secondInput),
    ]);

    expect(
      outputs.filter(
        (output) => output.status === WagerTransactionStatus.Processed,
      ),
    ).toHaveLength(1);
    const rejected = outputs.find(
      (output) => output.status === WagerTransactionStatus.Rejected,
    );
    expect(rejected?.failureCode).toBe(
      WagerTransactionFailureCode.InsufficientFunds,
    );

    const entityManager = orm.em.fork();
    const wallet = await entityManager.findOneOrFail(WalletRecord, {
      id: context.walletId,
    });
    expect(wallet.balance).toBe('20.00');
    expect(wallet.version).toBe(2);
    expect(
      await entityManager.count(WalletLedgerEntryRecord, {
        walletId: context.walletId,
      }),
    ).toBe(2);
  });

  test('rejeita um payload divergente para uma chave de idempotência persistida', async () => {
    const context = await createWallet('100.00');
    const input = wagerInput(context, {
      externalTransactionId: randomUUID(),
      idempotencyKey: randomUUID(),
    });
    await createWagerUseCase().execute(input);

    await expect(
      createWagerUseCase().execute({
        ...input,
        money: { amount: '30.00', currency: 'BRL' },
      }),
    ).rejects.toBeInstanceOf(WagerIdempotencyConflictError);
  });

  test('reproduz o saldo original após movimentações posteriores da carteira', async () => {
    const context = await createWallet('100.00');
    const firstInput = wagerInput(context, {
      externalTransactionId: randomUUID(),
      idempotencyKey: randomUUID(),
      money: { amount: '25.00', currency: 'BRL' },
    });
    const original = await createWagerUseCase().execute(firstInput);
    await createWagerUseCase().execute(
      wagerInput(context, {
        externalTransactionId: randomUUID(),
        idempotencyKey: randomUUID(),
        money: { amount: '10.00', currency: 'BRL' },
      }),
    );

    const replay = await createWagerUseCase().execute(firstInput);

    expect(original.balance.amount).toBe('75.00');
    expect(replay.balance.amount).toBe('75.00');
    expect(replay.idempotentReplay).toBe(true);
    const wallet = await orm.em.fork().findOneOrFail(WalletRecord, {
      id: context.walletId,
    });
    expect(wallet.balance).toBe('65.00');
  });

  test('permite a mesma chave de idempotência para provedores diferentes', async () => {
    const context = await createWallet('100.00');
    const sharedIdempotencyKey = randomUUID();
    const sharedExternalTransactionId = randomUUID();
    const baseInput = wagerInput(context, {
      externalTransactionId: sharedExternalTransactionId,
      idempotencyKey: sharedIdempotencyKey,
      money: { amount: '10.00', currency: 'BRL' },
    });

    await createWagerUseCase().execute(baseInput);
    await createWagerUseCase().execute({
      ...baseInput,
      providerId: 'provider-b',
    });

    const entityManager = orm.em.fork();
    expect(
      await entityManager.count(WagerTransactionRecord, {
        idempotencyKey: sharedIdempotencyKey,
      }),
    ).toBe(2);
    const wallet = await entityManager.findOneOrFail(WalletRecord, {
      id: context.walletId,
    });
    expect(wallet.balance).toBe('80.00');
  });

  test('permite somente um reembolso concorrente do mesmo tipo', async () => {
    const context = await createWallet('100.00');
    const betInput = wagerInput(context, {
      externalTransactionId: randomUUID(),
      idempotencyKey: randomUUID(),
      money: { amount: '25.00', currency: 'BRL' },
    });
    await createWagerUseCase().execute(betInput);

    const firstRefund = wagerInput(context, {
      externalTransactionId: randomUUID(),
      idempotencyKey: randomUUID(),
      kind: WagerTransactionKind.Refund,
      referenceExternalTransactionId: betInput.externalTransactionId,
      roundId: betInput.roundId,
      money: betInput.money,
    });
    const secondRefund = wagerInput(context, {
      externalTransactionId: randomUUID(),
      idempotencyKey: randomUUID(),
      kind: WagerTransactionKind.Refund,
      referenceExternalTransactionId: betInput.externalTransactionId,
      roundId: betInput.roundId,
      money: betInput.money,
    });

    const outputs = await Promise.all([
      createWagerUseCase().execute(firstRefund),
      createWagerUseCase().execute(secondRefund),
    ]);

    expect(
      outputs.filter(
        (output) => output.status === WagerTransactionStatus.Processed,
      ),
    ).toHaveLength(1);
    const rejected = outputs.find(
      (output) => output.status === WagerTransactionStatus.Rejected,
    );
    expect(rejected?.failureCode).toBe(
      WagerTransactionFailureCode.ReferenceAlreadyReversed,
    );

    const entityManager = orm.em.fork();
    const wallet = await entityManager.findOneOrFail(WalletRecord, {
      id: context.walletId,
    });
    expect(wallet.balance).toBe('100.00');
    expect(
      await entityManager.count(WalletLedgerEntryRecord, {
        walletId: context.walletId,
      }),
    ).toBe(3);
  });

  test('preserva a consistência com três instâncias independentes da aplicação', async () => {
    const context = await createWallet('100.00');
    const instances = await Promise.all([
      MikroORM.init(mikroOrmConfig),
      MikroORM.init(mikroOrmConfig),
      MikroORM.init(mikroOrmConfig),
    ]);
    try {
      const inputs = Array.from({ length: 3 }, () =>
        wagerInput(context, {
          externalTransactionId: randomUUID(),
          idempotencyKey: randomUUID(),
          money: { amount: '60.00', currency: 'BRL' },
        }),
      );
      const outputs = await Promise.all(
        inputs.map((input, index) =>
          createWagerUseCase(new UuidGenerator(), instances[index]).execute(
            input,
          ),
        ),
      );

      expect(
        outputs.filter(
          (output) => output.status === WagerTransactionStatus.Processed,
        ),
      ).toHaveLength(1);
      expect(
        outputs.filter(
          (output) => output.status === WagerTransactionStatus.Rejected,
        ),
      ).toHaveLength(2);
      const entityManager = orm.em.fork();
      const wallet = await entityManager.findOneOrFail(WalletRecord, {
        id: context.walletId,
      });
      expect(wallet.balance).toBe('40.00');
      expect(
        await entityManager.count(WalletLedgerEntryRecord, {
          walletId: context.walletId,
        }),
      ).toBe(2);
    } finally {
      await Promise.all(instances.map((instance) => instance.close(true)));
    }
  });

  test('reverte a transação e a atualização da carteira quando a persistência do ledger falha', async () => {
    const context = await createWallet('100.00');
    const existingLedgerId = randomUUID();
    await createWagerUseCase(
      new SequenceIdGenerator([randomUUID(), existingLedgerId]),
    ).execute(
      wagerInput(context, {
        externalTransactionId: randomUUID(),
        idempotencyKey: randomUUID(),
        money: { amount: '10.00', currency: 'BRL' },
      }),
    );

    const rolledBackTransactionId = randomUUID();
    await expect(
      createWagerUseCase(
        new SequenceIdGenerator([
          rolledBackTransactionId,
          existingLedgerId,
        ]),
      ).execute(
        wagerInput(context, {
          externalTransactionId: randomUUID(),
          idempotencyKey: randomUUID(),
          money: { amount: '10.00', currency: 'BRL' },
        }),
      ),
    ).rejects.toThrow();

    const entityManager = orm.em.fork();
    const wallet = await entityManager.findOneOrFail(WalletRecord, {
      id: context.walletId,
    });
    expect(wallet.balance).toBe('90.00');
    expect(wallet.version).toBe(2);
    expect(
      await entityManager.count(WagerTransactionRecord, {
        id: rolledBackTransactionId,
      }),
    ).toBe(0);
    expect(
      await entityManager.count(WalletLedgerEntryRecord, {
        walletId: context.walletId,
      }),
    ).toBe(2);
  });

  async function createWallet(initialBalance: string): Promise<{
    walletId: string;
    playerId: string;
  }> {
    const playerId = randomUUID();
    const output = await new CreateWalletUseCase(
      new MikroOrmWalletCreationRepository(orm.em.fork()),
      new UuidGenerator(),
      new SystemClock(),
      new Sha256PayloadHasher(),
    ).execute({
      playerId,
      initialBalance: { amount: initialBalance, currency: 'BRL' },
    });
    return { walletId: output.id, playerId };
  }

  function createWagerUseCase(
    idGenerator: IdGenerator = new UuidGenerator(),
    instance: MikroORM = orm,
  ): ProcessWagerTransactionUseCase {
    return new ProcessWagerTransactionUseCase(
      new MikroOrmWagerProcessingRepository(instance.em.fork()),
      idGenerator,
      new SystemClock(),
      new Sha256PayloadHasher(),
      new WagerOperationProcessor(),
    );
  }
});

function wagerInput(
  context: { walletId: string; playerId: string },
  overrides: Partial<ProcessWagerTransactionInput> = {},
): ProcessWagerTransactionInput {
  return {
    providerId: 'provider-a',
    externalTransactionId: randomUUID(),
    idempotencyKey: randomUUID(),
    walletId: context.walletId,
    playerId: context.playerId,
    roundId: `round-${randomUUID()}`,
    gameId: 'game-1',
    kind: WagerTransactionKind.Bet,
    money: { amount: '25.00', currency: 'BRL' },
    ...overrides,
  };
}

class SequenceIdGenerator implements IdGenerator {
  private cursor = 0;

  constructor(private readonly ids: readonly string[]) {}

  generate(): string {
    const id = this.ids[this.cursor];
    if (id === undefined) {
      throw new Error('Nenhum identificador foi configurado para este teste de integração');
    }
    this.cursor += 1;
    return id;
  }
}
