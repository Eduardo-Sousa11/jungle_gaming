export class InvalidMoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidMoneyError';
  }
}

export class CurrencyMismatchError extends Error {
  constructor(leftCurrency: string, rightCurrency: string) {
    super(`Currency mismatch: ${leftCurrency} and ${rightCurrency}`);
    this.name = 'CurrencyMismatchError';
  }
}
