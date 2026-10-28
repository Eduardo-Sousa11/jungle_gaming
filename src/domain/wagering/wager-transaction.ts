import { Money } from '../shared/money/money';
import { InvalidWagerTransactionError } from './wager-transaction.errors';

export enum WagerTransactionKind {
  Opening = 'OPENING',
  Bet = 'BET',
  Win = 'WIN',
  Loss = 'LOSS',
  Refund = 'REFUND',
  Rollback = 'ROLLBACK',
}

export enum WagerTransactionStatus {
  Pending = 'PENDING',
  PendingReference = 'PENDING_REFERENCE',
  Processed = 'PROCESSED',
  Rejected = 'REJECTED',
  Failed = 'FAILED',
}

export class WagerTransaction {
  private constructor(
    public readonly id: string,
    public readonly providerId: string,
    public readonly externalTransactionId: string,
    public readonly idempotencyKey: string,
    public readonly payloadHash: string,
    public readonly walletId: string,
    public readonly playerId: string,
    public readonly roundId: string,
    public readonly gameId: string,
    public readonly kind: WagerTransactionKind,
    public readonly money: Money,
    public readonly status: WagerTransactionStatus,
    private readonly _createdAt: Date,
    private readonly _processedAt: Date,
  ) {
    Object.freeze(this);
  }

  static createOpening(props: {
    readonly id: string;
    readonly walletId: string;
    readonly playerId: string;
    readonly money: Money;
    readonly payloadHash: string;
    readonly at: Date;
  }): WagerTransaction {
    if (!props.money.isPositive()) {
      throw new InvalidWagerTransactionError(
        'An opening transaction requires a positive amount',
      );
    }

    if (!/^[0-9a-f]{64}$/.test(props.payloadHash)) {
      throw new InvalidWagerTransactionError(
        'An opening transaction requires a SHA-256 payload hash',
      );
    }

    const externalTransactionId = `opening:${props.walletId}`;

    return new WagerTransaction(
      props.id,
      '__internal__',
      externalTransactionId,
      `__internal__:${externalTransactionId}`,
      props.payloadHash,
      props.walletId,
      props.playerId,
      '__opening__',
      '__system__',
      WagerTransactionKind.Opening,
      props.money,
      WagerTransactionStatus.Processed,
      new Date(props.at),
      new Date(props.at),
    );
  }

  get createdAt(): Date {
    return new Date(this._createdAt);
  }

  get processedAt(): Date {
    return new Date(this._processedAt);
  }
}
