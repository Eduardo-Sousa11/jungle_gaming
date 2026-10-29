import { describe, expect, test } from 'bun:test';

import type { Clock } from '../../shared/clock.port';
import type { IdGenerator } from '../../shared/id-generator.port';
import type { PayloadHasher } from '../../shared/payload-hasher.port';
import { CreateWalletUseCase } from './create-wallet.use-case';
import type {
  CreateWalletAggregate,
  WalletCreationRepository,
} from './wallet-creation.repository';

class CapturingWalletRepository implements WalletCreationRepository {
  aggregate?: CreateWalletAggregate;

  async create(aggregate: CreateWalletAggregate): Promise<void> {
    this.aggregate = aggregate;
  }
}

class SequenceIdGenerator implements IdGenerator {
  private cursor = 0;

  constructor(private readonly ids: readonly string[]) {}

  generate(): string {
    const id = this.ids[this.cursor];
    if (id === undefined) {
      throw new Error('Nenhum identificador foi configurado para este teste');
    }
    this.cursor += 1;
    return id;
  }
}

const fixedClock: Clock = {
  now: () => new Date('2026-10-27T12:00:00.000Z'),
};

const fixedHasher: PayloadHasher = {
  hash: () => 'a'.repeat(64),
};

describe('CreateWalletUseCase', () => {
  test('cria carteira, OPENING e ledger para um saldo positivo', async () => {
    const repository = new CapturingWalletRepository();
    const useCase = new CreateWalletUseCase(
      repository,
      new SequenceIdGenerator(['wallet-1', 'transaction-1', 'ledger-1']),
      fixedClock,
      fixedHasher,
    );

    const result = await useCase.execute({
      playerId: 'player-1',
      initialBalance: { amount: '100.00', currency: 'BRL' },
    });

    expect(result).toEqual({
      id: 'wallet-1',
      playerId: 'player-1',
      balance: { amount: '100.00', currency: 'BRL' },
      version: 1,
    });
    expect(repository.aggregate?.openingTransaction?.id).toBe('transaction-1');
    expect(repository.aggregate?.ledgerEntry?.id).toBe('ledger-1');
    expect(
      repository.aggregate?.ledgerEntry?.balanceBefore.toJSON().amount,
    ).toBe('0.00');
    expect(repository.aggregate?.ledgerEntry?.balanceAfter.toJSON().amount).toBe(
      '100.00',
    );
  });

  test('cria somente a carteira quando o saldo inicial é zero', async () => {
    const repository = new CapturingWalletRepository();
    const useCase = new CreateWalletUseCase(
      repository,
      new SequenceIdGenerator(['wallet-1']),
      fixedClock,
      fixedHasher,
    );

    const result = await useCase.execute({
      playerId: 'player-1',
      initialBalance: { amount: '0.00', currency: 'BRL' },
    });

    expect(result.balance.amount).toBe('0.00');
    expect(result.version).toBe(1);
    expect(repository.aggregate?.openingTransaction).toBeUndefined();
    expect(repository.aggregate?.ledgerEntry).toBeUndefined();
  });
});
