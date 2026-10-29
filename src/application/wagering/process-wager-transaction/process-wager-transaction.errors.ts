export class WagerWalletNotFoundError extends Error {
  constructor(public readonly walletId: string) {
    super(`A carteira ${walletId} não foi encontrada`);
    this.name = 'WagerWalletNotFoundError';
  }
}

export class WagerIdempotencyConflictError extends Error {
  constructor(
    public readonly providerId: string,
    public readonly idempotencyKey: string,
  ) {
    super(
      `A chave de idempotência ${idempotencyKey} já foi usada com outro payload pelo provedor ${providerId}`,
    );
    this.name = 'WagerIdempotencyConflictError';
  }
}

export class WagerExternalTransactionConflictError extends Error {
  constructor(
    public readonly providerId: string,
    public readonly externalTransactionId: string,
  ) {
    super(
      `A transação externa ${externalTransactionId} já existe para o provedor ${providerId}`,
    );
    this.name = 'WagerExternalTransactionConflictError';
  }
}

/** Sinaliza uma corrida vencida por outra transação no PostgreSQL. */
export class WagerPersistenceRaceError extends Error {
  constructor() {
    super('Outra transação de aposta concorrente venceu a disputa de unicidade na persistência');
    this.name = 'WagerPersistenceRaceError';
  }
}

export class InboxPayloadConflictError extends Error {
  constructor(
    public readonly consumerName: string,
    public readonly messageId: string,
  ) {
    super(
      `A mensagem da inbox ${consumerName}/${messageId} já foi recebida com outro payload`,
    );
    this.name = 'InboxPayloadConflictError';
  }
}
