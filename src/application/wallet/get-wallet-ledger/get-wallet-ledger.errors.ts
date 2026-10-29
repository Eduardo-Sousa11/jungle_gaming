export class InvalidLedgerCursorError extends Error {
  constructor(message = 'O cursor do ledger é inválido') {
    super(message);
    this.name = 'InvalidLedgerCursorError';
  }
}

export class InvalidLedgerPageLimitError extends Error {
  constructor(public readonly limit: number) {
    super('O limite da página do ledger deve ser um número inteiro entre 1 e 100');
    this.name = 'InvalidLedgerPageLimitError';
  }
}
