import { describe, expect, test } from 'bun:test';

import { CurrencyMismatchError, InvalidMoneyError } from './money.errors';
import { Money } from './money';

describe('Money', () => {
  test('creates and serializes a canonical decimal value', () => {
    const money = Money.from({ amount: '25.00', currency: 'BRL' });

    expect(money.toJSON()).toEqual({ amount: '25.00', currency: 'BRL' });
    expect(money.toString()).toBe('25.00 BRL');
  });

  test('performs exact decimal arithmetic', () => {
    const first = Money.from({ amount: '0.10', currency: 'BRL' });
    const second = Money.from({ amount: '0.20', currency: 'BRL' });

    expect(first.add(second).toJSON().amount).toBe('0.30');
    expect(second.subtract(first).toJSON().amount).toBe('0.10');
  });

  test('returns new values without mutating its operands', () => {
    const original = Money.from({ amount: '10.00', currency: 'BRL' });
    const result = original.add(
      Money.from({ amount: '5.00', currency: 'BRL' }),
    );

    expect(original.toJSON().amount).toBe('10.00');
    expect(result.toJSON().amount).toBe('15.00');
    expect(Object.isFrozen(original)).toBeTrue();
  });

  test('supports zero, negation and comparisons', () => {
    const zero = Money.zero('BRL');
    const positive = Money.from({ amount: '8.50', currency: 'BRL' });
    const negative = positive.negate();

    expect(zero.isZero()).toBeTrue();
    expect(positive.isPositive()).toBeTrue();
    expect(negative.isNegative()).toBeTrue();
    expect(negative.toJSON().amount).toBe('-8.50');
    expect(negative.isLessThan(zero)).toBeTrue();
    expect(positive.equals(negative.negate())).toBeTrue();
  });

  test.each([
    '',
    '1',
    '1.0',
    '1.001',
    '01.00',
    '-1.00',
    '+1.00',
    '1e2',
    'NaN',
    'Infinity',
  ])('rejects the invalid input amount %p', (amount) => {
    expect(() => Money.from({ amount, currency: 'BRL' })).toThrow(
      InvalidMoneyError,
    );
  });

  test('rejects an amount larger than NUMERIC(20, 2)', () => {
    expect(() =>
      Money.from({ amount: '1000000000000000000.00', currency: 'BRL' }),
    ).toThrow(InvalidMoneyError);
  });

  test.each(['brl', 'ZZZ', 'US', ''])('rejects invalid currency %p', (currency) => {
    expect(() => Money.from({ amount: '1.00', currency })).toThrow(
      InvalidMoneyError,
    );
  });

  test('rejects arithmetic between different currencies', () => {
    const reais = Money.from({ amount: '1.00', currency: 'BRL' });
    const dollars = Money.from({ amount: '1.00', currency: 'USD' });

    expect(() => reais.add(dollars)).toThrow(CurrencyMismatchError);
    expect(() => reais.subtract(dollars)).toThrow(CurrencyMismatchError);
    expect(() => reais.isLessThan(dollars)).toThrow(CurrencyMismatchError);
    expect(() => reais.equals(dollars)).toThrow(CurrencyMismatchError);
  });
});
