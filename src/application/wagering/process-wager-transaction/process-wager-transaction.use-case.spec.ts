import { createHash } from 'node:crypto';

import { describe, expect, test } from 'bun:test';

import type { Clock } from '../../shared/clock.port';
import type { IdGenerator } from '../../shared/id-generator.port';
import type { PayloadHasher } from '../../shared/payload-hasher.port';
import { Money } from '../../../domain/shared/money/money';
import { WagerOperationProcessor } from '../../../domain/wagering/wager-operation-processor';
import {
  WagerTransactionKind,
  WagerTransactionStatus,
} from '../../../domain/wagering/wager-transaction';
import { Wallet } from '../../../domain/wallet/wallet';
import {
  WagerExternalTransactionConflictError,
  WagerIdempotencyConflictError,
  WagerPersistenceRaceError,
  WagerWalletNotFoundError,
} from './process-wager-transaction.errors';
import {
  type ProcessWagerTransactionInput,
  ProcessWagerTransactionUseCase,
} from './process-wager-transaction.use-case';
import type {
  SaveWagerProcessingResult,
  StoredWagerTransaction,
  WagerProcessingRepository,
  WagerProcessingSession,
} from './wager-processing.repository';

const NOW = new Date('2026-10-28T10:00:00.000Z');

const BASE_INPUT: ProcessWagerTransactionInput = {
  providerId: 'provider-a',
  externalTransactionId: 'external-1',
  idempotencyKey: 'idempotency-1',
  walletId: 'wallet-1',
  playerId: 'player-1',
  roundId: 'round-1',
  gameId: 'game-1',
  kind: WagerTransactionKind.Bet,
  money: { amount: '25.00', currency: 'BRL' },
};

const fixedClock: Clock = {
  now: () => new Date(NOW),
};

const canonicalHasher: PayloadHasher = {
  hash: (payload) =>
    createHash('sha256').update(JSON.stringify(payload)).digest('hex'),
};

describe('ProcessWagerTransactionUseCase', () => {
  test('processes and saves a new financial transaction', async () => {
    const session = new InMemoryWagerProcessingSession(openWallet('100.00'));
    const useCase = createUseCase(session, ['transaction-1', 'ledger-1']);

    const output = await useCase.execute(BASE_INPUT);

    expect(output).toEqual({
      transactionId: 'transaction-1',
      status: WagerTransactionStatus.Processed,
      balance: { amount: '75.00', currency: 'BRL' },
      idempotentReplay: false,
    });
    expect(session.lockCalls).toBe(1);
    expect(session.saves).toHaveLength(1);
    expect(session.saves[0]?.ledgerEntry?.id).toBe('ledger-1');
  });

  test('replays the original snapshot without locking or applying another debit', async () => {
    const wallet = openWallet('100.00');
    const session = new InMemoryWagerProcessingSession(wallet);
    const useCase = createUseCase(session, ['transaction-1', 'ledger-1']);

    const original = await useCase.execute(BASE_INPUT);
    const replay = await useCase.execute(BASE_INPUT);

    expect(original.idempotentReplay).toBe(false);
    expect(replay).toEqual({
      ...original,
      idempotentReplay: true,
    });
    expect(wallet.balance.toJSON().amount).toBe('75.00');
    expect(session.lockCalls).toBe(1);
    expect(session.saves).toHaveLength(1);
  });

  test('rejects the same idempotency key with a different business payload', async () => {
    const session = new InMemoryWagerProcessingSession(openWallet('100.00'));
    const useCase = createUseCase(session, ['transaction-1', 'ledger-1']);
    await useCase.execute(BASE_INPUT);

    await expect(
      useCase.execute({
        ...BASE_INPUT,
        money: { amount: '30.00', currency: 'BRL' },
      }),
    ).rejects.toBeInstanceOf(WagerIdempotencyConflictError);
    expect(session.saves).toHaveLength(1);
  });

  test('rejects the same provider transaction with another idempotency key', async () => {
    const session = new InMemoryWagerProcessingSession(openWallet('100.00'));
    const useCase = createUseCase(session, ['transaction-1', 'ledger-1']);
    await useCase.execute(BASE_INPUT);

    await expect(
      useCase.execute({
        ...BASE_INPUT,
        idempotencyKey: 'another-key',
      }),
    ).rejects.toBeInstanceOf(WagerExternalTransactionConflictError);
    expect(session.saves).toHaveLength(1);
  });

  test('scopes idempotency and external transaction identifiers by provider', async () => {
    const session = new InMemoryWagerProcessingSession(openWallet('100.00'));
    const useCase = createUseCase(session, [
      'transaction-1',
      'ledger-1',
      'transaction-2',
      'ledger-2',
    ]);

    const first = await useCase.execute(BASE_INPUT);
    const second = await useCase.execute({
      ...BASE_INPUT,
      providerId: 'provider-b',
    });

    expect(first.transactionId).toBe('transaction-1');
    expect(second.transactionId).toBe('transaction-2');
    expect(second.balance.amount).toBe('50.00');
    expect(session.saves).toHaveLength(2);
  });

  test('returns a replay discovered by the second check after locking the wallet', async () => {
    const session = new InMemoryWagerProcessingSession(openWallet('100.00'));
    session.existingAfterLock = storedTransaction({
      transactionId: 'winner-transaction',
      balanceAmount: '75.00',
      payloadHash: payloadHashFor(BASE_INPUT),
    });
    const useCase = createUseCase(session, []);

    const output = await useCase.execute(BASE_INPUT);

    expect(output.transactionId).toBe('winner-transaction');
    expect(output.idempotentReplay).toBe(true);
    expect(session.lockCalls).toBe(1);
    expect(session.saves).toHaveLength(0);
  });

  test('replays a matching external transaction that becomes visible between reads', async () => {
    const session = new InMemoryWagerProcessingSession(openWallet('100.00'));
    session.existingByExternalOnly = storedTransaction({
      transactionId: 'concurrent-winner',
      balanceAmount: '75.00',
      payloadHash: payloadHashFor(BASE_INPUT),
    });
    const useCase = createUseCase(session, []);

    const output = await useCase.execute(BASE_INPUT);

    expect(output.transactionId).toBe('concurrent-winner');
    expect(output.idempotentReplay).toBe(true);
    expect(session.lockCalls).toBe(0);
    expect(session.saves).toHaveLength(0);
  });

  test('retries once when a PostgreSQL uniqueness race is reported', async () => {
    const session = new InMemoryWagerProcessingSession(openWallet('100.00'));
    const repository = new InMemoryWagerProcessingRepository(session);
    repository.racesBeforeWork = 1;
    const useCase = createUseCase(
      session,
      ['transaction-1', 'ledger-1'],
      repository,
    );

    const output = await useCase.execute(BASE_INPUT);

    expect(output.status).toBe(WagerTransactionStatus.Processed);
    expect(repository.transactionalCalls).toBe(2);
    expect(session.saves).toHaveLength(1);
  });

  test('does not retry a persistence race more than once', async () => {
    const session = new InMemoryWagerProcessingSession(openWallet('100.00'));
    const repository = new InMemoryWagerProcessingRepository(session);
    repository.racesBeforeWork = 2;
    const useCase = createUseCase(session, [], repository);

    await expect(useCase.execute(BASE_INPUT)).rejects.toBeInstanceOf(
      WagerPersistenceRaceError,
    );
    expect(repository.transactionalCalls).toBe(2);
  });

  test('fails without saving when the wallet does not exist', async () => {
    const session = new InMemoryWagerProcessingSession(undefined);
    const useCase = createUseCase(session, []);

    await expect(useCase.execute(BASE_INPUT)).rejects.toBeInstanceOf(
      WagerWalletNotFoundError,
    );
    expect(session.saves).toHaveLength(0);
  });
});

class InMemoryWagerProcessingRepository implements WagerProcessingRepository {
  transactionalCalls = 0;
  racesBeforeWork = 0;

  constructor(private readonly session: WagerProcessingSession) {}

  async transactional<T>(
    work: (session: WagerProcessingSession) => Promise<T>,
  ): Promise<T> {
    this.transactionalCalls += 1;
    if (this.racesBeforeWork > 0) {
      this.racesBeforeWork -= 1;
      throw new WagerPersistenceRaceError();
    }
    return work(this.session);
  }
}

class InMemoryWagerProcessingSession implements WagerProcessingSession {
  readonly saves: SaveWagerProcessingResult[] = [];
  lockCalls = 0;
  existingAfterLock?: StoredWagerTransaction;
  existingByExternalOnly?: StoredWagerTransaction;
  private locked = false;
  private readonly byIdempotency = new Map<string, StoredWagerTransaction>();
  private readonly byExternal = new Map<string, StoredWagerTransaction>();

  constructor(private readonly wallet: Wallet | undefined) {}

  async findByIdempotencyKey(
    providerId: string,
    idempotencyKey: string,
  ): Promise<StoredWagerTransaction | undefined> {
    if (this.locked && this.existingAfterLock !== undefined) {
      return this.existingAfterLock;
    }
    return this.byIdempotency.get(`${providerId}:${idempotencyKey}`);
  }

  async findByExternalTransactionId(
    providerId: string,
    externalTransactionId: string,
  ): Promise<StoredWagerTransaction | undefined> {
    if (this.existingByExternalOnly !== undefined) {
      return this.existingByExternalOnly;
    }
    return this.byExternal.get(`${providerId}:${externalTransactionId}`);
  }

  async lockWallet(): Promise<Wallet | undefined> {
    this.lockCalls += 1;
    this.locked = true;
    return this.wallet;
  }

  async findReference() {
    return undefined;
  }

  async hasProcessedReversal(): Promise<boolean> {
    return false;
  }

  async save(result: SaveWagerProcessingResult): Promise<void> {
    this.saves.push(result);
    const stored: StoredWagerTransaction = Object.freeze({
      id: result.transaction.id,
      providerId: result.transaction.providerId,
      externalTransactionId: result.transaction.externalTransactionId,
      idempotencyKey: result.transaction.idempotencyKey,
      payloadHash: result.transaction.payloadHash,
      responseSnapshot: result.responseSnapshot,
    });
    this.byIdempotency.set(
      `${stored.providerId}:${stored.idempotencyKey}`,
      stored,
    );
    this.byExternal.set(
      `${stored.providerId}:${stored.externalTransactionId}`,
      stored,
    );
  }
}

class SequenceIdGenerator implements IdGenerator {
  private cursor = 0;

  constructor(private readonly ids: readonly string[]) {}

  generate(): string {
    const id = this.ids[this.cursor];
    if (id === undefined) {
      throw new Error('No identifier configured for this test');
    }
    this.cursor += 1;
    return id;
  }
}

function createUseCase(
  session: InMemoryWagerProcessingSession,
  ids: readonly string[],
  repository = new InMemoryWagerProcessingRepository(session),
): ProcessWagerTransactionUseCase {
  return new ProcessWagerTransactionUseCase(
    repository,
    new SequenceIdGenerator(ids),
    fixedClock,
    canonicalHasher,
    new WagerOperationProcessor(),
  );
}

function openWallet(amount: string): Wallet {
  return Wallet.open({
    id: BASE_INPUT.walletId,
    playerId: BASE_INPUT.playerId,
    initialBalance: Money.from({ amount, currency: 'BRL' }),
    at: NOW,
  });
}

function payloadHashFor(input: ProcessWagerTransactionInput): string {
  return canonicalHasher.hash({
    externalTransactionId: input.externalTransactionId,
    gameId: input.gameId,
    kind: input.kind,
    money: input.money,
    playerId: input.playerId,
    providerId: input.providerId,
    referenceExternalTransactionId:
      input.referenceExternalTransactionId ?? null,
    roundId: input.roundId,
    walletId: input.walletId,
  });
}

function storedTransaction(props: {
  transactionId: string;
  balanceAmount: string;
  payloadHash: string;
}): StoredWagerTransaction {
  return Object.freeze({
    id: props.transactionId,
    providerId: BASE_INPUT.providerId,
    externalTransactionId: BASE_INPUT.externalTransactionId,
    idempotencyKey: BASE_INPUT.idempotencyKey,
    payloadHash: props.payloadHash,
    responseSnapshot: Object.freeze({
      transactionId: props.transactionId,
      status: WagerTransactionStatus.Processed,
      balance: Object.freeze({ amount: props.balanceAmount, currency: 'BRL' }),
    }),
  });
}
