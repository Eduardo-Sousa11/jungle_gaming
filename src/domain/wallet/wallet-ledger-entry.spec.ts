import { describe, expect, test } from 'bun:test';

import { Money } from '../shared/money/money';
import { InvalidLedgerEntryError } from './wallet.errors';
import { WalletLedgerEntry } from './wallet-ledger-entry';
import { WalletMovementDirection } from './wallet';

function money(amount: string): Money {
  return Money.from({ amount, currency: 'BRL' });
}

describe('WalletLedgerEntry', () => {
  test('cria um lançamento de crédito balanceado', () => {
    const entry = WalletLedgerEntry.create({
      id: 'ledger-1',
      walletId: 'wallet-1',
      transactionId: 'transaction-1',
      direction: WalletMovementDirection.Credit,
      money: money('25.00'),
      balanceBefore: money('100.00'),
      balanceAfter: money('125.00'),
      createdAt: new Date('2026-10-27T10:00:00.000Z'),
    });

    expect(entry.isBalanced()).toBeTrue();
    expect(Object.isFrozen(entry)).toBeTrue();
  });

  test('cria um lançamento de débito balanceado', () => {
    const entry = WalletLedgerEntry.create({
      id: 'ledger-1',
      walletId: 'wallet-1',
      transactionId: 'transaction-1',
      direction: WalletMovementDirection.Debit,
      money: money('25.00'),
      balanceBefore: money('100.00'),
      balanceAfter: money('75.00'),
      createdAt: new Date('2026-10-27T10:00:00.000Z'),
    });

    expect(entry.isBalanced()).toBeTrue();
  });

  test('rejeita um lançamento aritmeticamente inválido', () => {
    expect(() =>
      WalletLedgerEntry.create({
        id: 'ledger-1',
        walletId: 'wallet-1',
        transactionId: 'transaction-1',
        direction: WalletMovementDirection.Debit,
        money: money('25.00'),
        balanceBefore: money('100.00'),
        balanceAfter: money('80.00'),
        createdAt: new Date(),
      }),
    ).toThrow(InvalidLedgerEntryError);
  });

  test('rejeita um lançamento de valor zero', () => {
    expect(() =>
      WalletLedgerEntry.create({
        id: 'ledger-1',
        walletId: 'wallet-1',
        transactionId: 'transaction-1',
        direction: WalletMovementDirection.Credit,
        money: Money.zero('BRL'),
        balanceBefore: money('100.00'),
        balanceAfter: money('100.00'),
        createdAt: new Date(),
      }),
    ).toThrow(InvalidLedgerEntryError);
  });
});
