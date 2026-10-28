export class InvalidLedgerCursorError extends Error {
  constructor(message = 'The ledger cursor is invalid') {
    super(message);
    this.name = 'InvalidLedgerCursorError';
  }
}

export class InvalidLedgerPageLimitError extends Error {
  constructor(public readonly limit: number) {
    super('Ledger page limit must be an integer between 1 and 100');
    this.name = 'InvalidLedgerPageLimitError';
  }
}
