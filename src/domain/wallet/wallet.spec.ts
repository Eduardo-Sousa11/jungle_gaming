import { describe, expect, test } from 'bun:test';

import { CurrencyMismatchError } from '../shared/money/money.errors';
import { Money } from '../shared/money/money';
import {
  InsufficientWalletBalanceError,
  NonPositiveWalletMovementError,
} from './wallet.errors';
import { Wallet, WalletMovementDirection } from './wallet';

const openedAt = new Date('2026-10-27T10:00:00.000Z');

function openWallet(amount = '100.00'): Wallet {
  return Wallet.open({
    id: 'wallet-1',
    playerId: 'player-1',
    initialBalance: Money.from({ amount, currency: 'BRL' }),
    at: openedAt,
  });
}

describe('Wallet', () => {
  test('abre com versão um e o saldo solicitado', () => {
    const wallet = openWallet();

    expect(wallet.balance.toJSON()).toEqual({
      amount: '100.00',
      currency: 'BRL',
    });
    expect(wallet.version).toBe(1);
    expect(wallet.createdAt).toEqual(openedAt);
    expect(wallet.updatedAt).toEqual(openedAt);
  });

  test('credita o saldo e incrementa a versão', () => {
    const wallet = openWallet();
    const changedAt = new Date('2026-10-27T10:01:00.000Z');

    const change = wallet.credit(
      Money.from({ amount: '25.00', currency: 'BRL' }),
      changedAt,
    );

    expect(change.direction).toBe(WalletMovementDirection.Credit);
    expect(change.balanceBefore.toJSON().amount).toBe('100.00');
    expect(change.balanceAfter.toJSON().amount).toBe('125.00');
    expect(wallet.balance.toJSON().amount).toBe('125.00');
    expect(wallet.version).toBe(2);
    expect(wallet.updatedAt).toEqual(changedAt);
  });

  test('debita o saldo e incrementa a versão', () => {
    const wallet = openWallet();

    const change = wallet.debit(
      Money.from({ amount: '40.00', currency: 'BRL' }),
      new Date('2026-10-27T10:01:00.000Z'),
    );

    expect(change.direction).toBe(WalletMovementDirection.Debit);
    expect(wallet.balance.toJSON().amount).toBe('60.00');
    expect(wallet.version).toBe(2);
  });

  test('rejeita um débito que tornaria o saldo negativo', () => {
    const wallet = openWallet('10.00');

    expect(() =>
      wallet.debit(
        Money.from({ amount: '10.01', currency: 'BRL' }),
        new Date(),
      ),
    ).toThrow(InsufficientWalletBalanceError);
    expect(wallet.balance.toJSON().amount).toBe('10.00');
    expect(wallet.version).toBe(1);
  });

  test('rejeita movimentações de valor zero', () => {
    const wallet = openWallet();

    expect(() => wallet.credit(Money.zero('BRL'), new Date())).toThrow(
      NonPositiveWalletMovementError,
    );
    expect(() => wallet.debit(Money.zero('BRL'), new Date())).toThrow(
      NonPositiveWalletMovementError,
    );
  });

  test('rejeita movimentações em outra moeda', () => {
    const wallet = openWallet();

    expect(() =>
      wallet.credit(
        Money.from({ amount: '1.00', currency: 'USD' }),
        new Date(),
      ),
    ).toThrow(CurrencyMismatchError);
  });

  test('reidrata o estado persistido sem aplicar transições', () => {
    const wallet = Wallet.rehydrate({
      id: 'wallet-1',
      playerId: 'player-1',
      currency: 'BRL',
      balance: Money.from({ amount: '75.00', currency: 'BRL' }),
      version: 8,
      createdAt: openedAt,
      updatedAt: new Date('2026-10-27T11:00:00.000Z'),
    });

    expect(wallet.balance.toJSON().amount).toBe('75.00');
    expect(wallet.version).toBe(8);
  });
});
