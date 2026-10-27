import Decimal from 'decimal.js';

import { CurrencyMismatchError, InvalidMoneyError } from './money.errors';

export interface MoneyProps {
  readonly amount: string;
  readonly currency: string;
}

const DECIMAL_AMOUNT_PATTERN = /^(?:0|[1-9]\d*)\.\d{2}$/;
const CURRENCY_PATTERN = /^[A-Z]{3}$/;
const MAX_INTEGER_DIGITS = 18;
const SUPPORTED_CURRENCIES = new Set<string>(
  Intl.supportedValuesOf('currency'),
);

export class Money {
  private constructor(
    private readonly value: Decimal,
    public readonly currency: string,
  ) {
    Object.freeze(this);
  }

  static from(props: MoneyProps): Money {
    Money.assertValidCurrency(props.currency);
    Money.assertValidInputAmount(props.amount);

    return new Money(new Decimal(props.amount), props.currency);
  }

  static zero(currency: string): Money {
    Money.assertValidCurrency(currency);
    return new Money(new Decimal(0), currency);
  }

  add(other: Money): Money {
    this.assertSameCurrency(other);
    return Money.fromDecimal(this.value.add(other.value), this.currency);
  }

  subtract(other: Money): Money {
    this.assertSameCurrency(other);
    return Money.fromDecimal(this.value.sub(other.value), this.currency);
  }

  negate(): Money {
    return Money.fromDecimal(this.value.negated(), this.currency);
  }

  isZero(): boolean {
    return this.value.isZero();
  }

  isPositive(): boolean {
    return this.value.isPositive() && !this.value.isZero();
  }

  isNegative(): boolean {
    return this.value.isNegative();
  }

  isLessThan(other: Money): boolean {
    this.assertSameCurrency(other);
    return this.value.lessThan(other.value);
  }

  equals(other: Money): boolean {
    this.assertSameCurrency(other);
    return this.value.equals(other.value);
  }

  toJSON(): MoneyProps {
    return Object.freeze({
      amount: this.value.toFixed(2),
      currency: this.currency,
    });
  }

  toString(): string {
    return `${this.value.toFixed(2)} ${this.currency}`;
  }

  private static fromDecimal(value: Decimal, currency: string): Money {
    if (!value.isFinite() || value.decimalPlaces() > 2) {
      throw new InvalidMoneyError('Money operation produced an invalid amount');
    }

    const integerDigits = value.abs().trunc().toFixed(0).length;
    if (integerDigits > MAX_INTEGER_DIGITS) {
      throw new InvalidMoneyError('Money amount exceeds persistence precision');
    }

    return new Money(new Decimal(value), currency);
  }

  private static assertValidInputAmount(amount: string): void {
    if (!DECIMAL_AMOUNT_PATTERN.test(amount)) {
      throw new InvalidMoneyError(
        'Amount must be a non-negative decimal string with exactly two places',
      );
    }

    const decimalPosition = amount.indexOf('.');
    if (decimalPosition > MAX_INTEGER_DIGITS) {
      throw new InvalidMoneyError('Money amount exceeds persistence precision');
    }
  }

  private static assertValidCurrency(currency: string): void {
    if (
      !CURRENCY_PATTERN.test(currency) ||
      !SUPPORTED_CURRENCIES.has(currency)
    ) {
      throw new InvalidMoneyError(`Unsupported ISO-4217 currency: ${currency}`);
    }
  }

  private assertSameCurrency(other: Money): void {
    if (this.currency !== other.currency) {
      throw new CurrencyMismatchError(this.currency, other.currency);
    }
  }
}
