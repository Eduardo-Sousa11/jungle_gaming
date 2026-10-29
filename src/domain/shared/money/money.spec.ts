import { describe, expect, test } from 'bun:test';

import { CurrencyMismatchError, InvalidMoneyError } from './money.errors';
import { Money } from './money';

describe('Money', () => {
  test('cria e serializa um valor decimal canônico', () => {
    const money = Money.from({ amount: '25.00', currency: 'BRL' });

    expect(money.toJSON()).toEqual({ amount: '25.00', currency: 'BRL' });
    expect(money.toString()).toBe('25.00 BRL');
  });

  test('realiza aritmética decimal exata', () => {
    const first = Money.from({ amount: '0.10', currency: 'BRL' });
    const second = Money.from({ amount: '0.20', currency: 'BRL' });

    expect(first.add(second).toJSON().amount).toBe('0.30');
    expect(second.subtract(first).toJSON().amount).toBe('0.10');
  });

  test('retorna novos valores sem alterar os operandos', () => {
    const original = Money.from({ amount: '10.00', currency: 'BRL' });
    const result = original.add(
      Money.from({ amount: '5.00', currency: 'BRL' }),
    );

    expect(original.toJSON().amount).toBe('10.00');
    expect(result.toJSON().amount).toBe('15.00');
    expect(Object.isFrozen(original)).toBeTrue();
  });

  test('aceita zero, negação e comparações', () => {
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
  ])('rejeita o valor de entrada inválido %p', (amount) => {
    expect(() => Money.from({ amount, currency: 'BRL' })).toThrow(
      InvalidMoneyError,
    );
  });

  test('rejeita um valor maior que NUMERIC(20, 2)', () => {
    expect(() =>
      Money.from({ amount: '1000000000000000000.00', currency: 'BRL' }),
    ).toThrow(InvalidMoneyError);
  });

  test.each(['brl', 'ZZZ', 'US', ''])('rejeita a moeda inválida %p', (currency) => {
    expect(() => Money.from({ amount: '1.00', currency })).toThrow(
      InvalidMoneyError,
    );
  });

  test('rejeita operações aritméticas entre moedas diferentes', () => {
    const reais = Money.from({ amount: '1.00', currency: 'BRL' });
    const dollars = Money.from({ amount: '1.00', currency: 'USD' });

    expect(() => reais.add(dollars)).toThrow(CurrencyMismatchError);
    expect(() => reais.subtract(dollars)).toThrow(CurrencyMismatchError);
    expect(() => reais.isLessThan(dollars)).toThrow(CurrencyMismatchError);
    expect(() => reais.equals(dollars)).toThrow(CurrencyMismatchError);
  });
});
