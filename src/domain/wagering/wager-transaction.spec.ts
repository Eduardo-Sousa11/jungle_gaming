import { describe, expect, test } from 'bun:test';

import { Money } from '../shared/money/money';
import {
  WagerTransaction,
  WagerTransactionKind,
  WagerTransactionStatus,
} from './wager-transaction';

describe('WagerTransaction opening', () => {
  test('creates an internal processed opening transaction', () => {
    const transaction = WagerTransaction.createOpening({
      id: 'transaction-1',
      walletId: 'wallet-1',
      playerId: 'player-1',
      money: Money.from({ amount: '100.00', currency: 'BRL' }),
      payloadHash: 'a'.repeat(64),
      at: new Date('2026-10-27T10:00:00.000Z'),
    });

    expect(transaction.kind).toBe(WagerTransactionKind.Opening);
    expect(transaction.status).toBe(WagerTransactionStatus.Processed);
    expect(transaction.providerId).toBe('__internal__');
    expect(transaction.externalTransactionId).toBe('opening:wallet-1');
    expect(transaction.idempotencyKey).toBe('__internal__:opening:wallet-1');
  });

  test('rejects an opening transaction with zero balance', () => {
    expect(() =>
      WagerTransaction.createOpening({
        id: 'transaction-1',
        walletId: 'wallet-1',
        playerId: 'player-1',
        money: Money.zero('BRL'),
        payloadHash: 'a'.repeat(64),
        at: new Date(),
      }),
    ).toThrow();
  });
});
