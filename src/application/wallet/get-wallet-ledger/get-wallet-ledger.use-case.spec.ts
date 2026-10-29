import { describe, expect, test } from 'bun:test';

import { WalletMovementDirection } from '../../../domain/wallet/wallet';
import { WalletNotFoundError } from '../get-wallet/get-wallet.errors';
import {
  InvalidLedgerCursorError,
  InvalidLedgerPageLimitError,
} from './get-wallet-ledger.errors';
import {
  DEFAULT_LEDGER_PAGE_LIMIT,
  GetWalletLedgerUseCase,
} from './get-wallet-ledger.use-case';
import type {
  LedgerCursorCodec,
  LedgerCursorPayload,
} from './ledger-cursor.codec';
import type {
  WalletLedgerPage,
  WalletLedgerPageQuery,
  WalletLedgerQueryRepository,
} from './wallet-ledger-query.repository';

class CapturingLedgerRepository implements WalletLedgerQueryRepository {
  query?: WalletLedgerPageQuery;

  constructor(private readonly page?: WalletLedgerPage) {}

  async findPage(query: WalletLedgerPageQuery): Promise<WalletLedgerPage | undefined> {
    this.query = query;
    return this.page;
  }
}

class FakeLedgerCursorCodec implements LedgerCursorCodec {
  encoded?: LedgerCursorPayload;

  constructor(private readonly decoded?: LedgerCursorPayload) {}

  encode(payload: LedgerCursorPayload): string {
    this.encoded = payload;
    return 'next-cursor';
  }

  decode(): LedgerCursorPayload {
    if (this.decoded === undefined) {
      throw new InvalidLedgerCursorError();
    }
    return this.decoded;
  }
}

const firstEntry = {
  id: 'ledger-1',
  transactionId: 'transaction-1',
  direction: WalletMovementDirection.Credit,
  money: { amount: '100.00', currency: 'BRL' },
  balanceBefore: { amount: '0.00', currency: 'BRL' },
  balanceAfter: { amount: '100.00', currency: 'BRL' },
  createdAt: '2026-10-28T12:00:00.000Z',
} as const;

describe('GetWalletLedgerUseCase', () => {
  test('usa o limite padrão e emite um cursor a partir do último lançamento retornado', async () => {
    const repository = new CapturingLedgerRepository({
      entries: [firstEntry],
      hasMore: true,
    });
    const codec = new FakeLedgerCursorCodec();
    const useCase = new GetWalletLedgerUseCase(repository, codec);

    const result = await useCase.execute({ walletId: 'wallet-1' });

    expect(repository.query).toEqual({
      walletId: 'wallet-1',
      limit: DEFAULT_LEDGER_PAGE_LIMIT,
    });
    expect(result).toEqual({ items: [firstEntry], nextCursor: 'next-cursor' });
    expect(codec.encoded).toEqual({
      walletId: 'wallet-1',
      createdAt: new Date(firstEntry.createdAt),
      entryId: firstEntry.id,
    });
  });

  test('decodifica um cursor para uma posição exclusiva do conjunto de chaves', async () => {
    const position = {
      walletId: 'wallet-1',
      createdAt: new Date('2026-10-28T11:00:00.000Z'),
      entryId: 'ledger-previous',
    };
    const repository = new CapturingLedgerRepository({
      entries: [],
      hasMore: false,
    });
    const useCase = new GetWalletLedgerUseCase(
      repository,
      new FakeLedgerCursorCodec(position),
    );

    const result = await useCase.execute({
      walletId: 'wallet-1',
      cursor: 'cursor',
      limit: 20,
    });

    expect(repository.query).toEqual({
      walletId: 'wallet-1',
      limit: 20,
      after: {
        createdAt: position.createdAt,
        entryId: position.entryId,
      },
    });
    expect(result).toEqual({ items: [] });
  });

  test('rejeita um cursor emitido para outra carteira', async () => {
    const repository = new CapturingLedgerRepository({
      entries: [],
      hasMore: false,
    });
    const useCase = new GetWalletLedgerUseCase(
      repository,
      new FakeLedgerCursorCodec({
        walletId: 'wallet-2',
        createdAt: new Date('2026-10-28T11:00:00.000Z'),
        entryId: 'ledger-1',
      }),
    );

    await expect(
      useCase.execute({ walletId: 'wallet-1', cursor: 'cursor' }),
    ).rejects.toBeInstanceOf(InvalidLedgerCursorError);
    expect(repository.query).toBeUndefined();
  });

  test('rejeita um limite fora do intervalo', async () => {
    const useCase = new GetWalletLedgerUseCase(
      new CapturingLedgerRepository(),
      new FakeLedgerCursorCodec(),
    );

    await expect(
      useCase.execute({ walletId: 'wallet-1', limit: 101 }),
    ).rejects.toBeInstanceOf(InvalidLedgerPageLimitError);
  });

  test('informa uma carteira inexistente', async () => {
    const useCase = new GetWalletLedgerUseCase(
      new CapturingLedgerRepository(),
      new FakeLedgerCursorCodec(),
    );

    await expect(
      useCase.execute({ walletId: 'wallet-missing' }),
    ).rejects.toBeInstanceOf(WalletNotFoundError);
  });
});
