export class InvalidMoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidMoneyError';
  }
}

export class CurrencyMismatchError extends Error {
  constructor(leftCurrency: string, rightCurrency: string) {
    super(`Moedas incompatíveis: ${leftCurrency} e ${rightCurrency}`);
    this.name = 'CurrencyMismatchError';
  }
}
