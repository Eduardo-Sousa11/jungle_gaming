import { Money } from '../shared/money/money';
import { WalletMovementDirection } from '../wallet/wallet';
import {
  InvalidTransactionStateError,
  InvalidWagerReferenceError,
  InvalidWagerTransactionError,
  WagerReferenceFailureReason,
} from './wager-transaction.errors';

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

export enum WagerTransactionFailureCode {
  InsufficientFunds = 'INSUFFICIENT_FUNDS',
  WalletNotFound = 'WALLET_NOT_FOUND',
  WalletMismatch = 'WALLET_MISMATCH',
  PlayerMismatch = 'PLAYER_MISMATCH',
  CurrencyMismatch = 'CURRENCY_MISMATCH',
  ProviderMismatch = 'PROVIDER_MISMATCH',
  RoundMismatch = 'ROUND_MISMATCH',
  ReferenceNotFound = 'REFERENCE_NOT_FOUND',
  ReferenceMismatch = 'REFERENCE_MISMATCH',
  ReferenceNotProcessed = 'REFERENCE_NOT_PROCESSED',
  InvalidReferenceKind = 'INVALID_REFERENCE_KIND',
  ReferenceAmountMismatch = 'REFERENCE_AMOUNT_MISMATCH',
  ReferenceAlreadyReversed = 'REFERENCE_ALREADY_REVERSED',
  ReversalWouldMakeBalanceNegative = 'REVERSAL_WOULD_MAKE_BALANCE_NEGATIVE',
  PermanentInfrastructureFailure = 'PERMANENT_INFRASTRUCTURE_FAILURE',
}

export interface CreateWagerTransactionProps {
  readonly id: string;
  readonly providerId: string;
  readonly externalTransactionId: string;
  readonly idempotencyKey: string;
  readonly payloadHash: string;
  readonly walletId: string;
  readonly playerId: string;
  readonly roundId: string;
  readonly gameId: string;
  readonly kind: WagerTransactionKind;
  readonly money: Money;
  readonly referenceExternalTransactionId?: string;
  readonly at: Date;
}

export interface WagerTransactionState {
  readonly id: string;
  readonly providerId: string;
  readonly externalTransactionId: string;
  readonly idempotencyKey: string;
  readonly payloadHash: string;
  readonly walletId: string;
  readonly playerId: string;
  readonly roundId: string;
  readonly gameId: string;
  readonly kind: WagerTransactionKind;
  readonly money: Money;
  readonly referenceExternalTransactionId?: string;
  readonly status: WagerTransactionStatus;
  readonly referenceTransactionId?: string;
  readonly failureCode?: WagerTransactionFailureCode;
  readonly createdAt: Date;
  readonly processedAt?: Date;
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
    public readonly referenceExternalTransactionId: string | undefined,
    private readonly _createdAt: Date,
    private _status: WagerTransactionStatus,
    private _referenceTransactionId?: string,
    private _failureCode?: WagerTransactionFailureCode,
    private _processedAt?: Date,
  ) {}

  static create(props: CreateWagerTransactionProps): WagerTransaction {
    WagerTransaction.assertExternalCreationProps(props);

    return new WagerTransaction(
      props.id,
      props.providerId,
      props.externalTransactionId,
      props.idempotencyKey,
      props.payloadHash,
      props.walletId,
      props.playerId,
      props.roundId,
      props.gameId,
      props.kind,
      props.money,
      props.referenceExternalTransactionId,
      new Date(props.at),
      WagerTransactionStatus.Pending,
    );
  }

  static createOpening(props: {
    readonly id: string;
    readonly walletId: string;
    readonly playerId: string;
    readonly money: Money;
    readonly payloadHash: string;
    readonly at: Date;
  }): WagerTransaction {
    WagerTransaction.assertRequiredIdentifiers({
      id: props.id,
      walletId: props.walletId,
      playerId: props.playerId,
    });

    if (!props.money.isPositive()) {
      throw new InvalidWagerTransactionError(
        'An opening transaction requires a positive amount',
      );
    }

    WagerTransaction.assertPayloadHash(props.payloadHash);
    WagerTransaction.assertValidDate(props.at);

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
      undefined,
      new Date(props.at),
      WagerTransactionStatus.Processed,
      undefined,
      undefined,
      new Date(props.at),
    );
  }

  static rehydrate(state: WagerTransactionState): WagerTransaction {
    return new WagerTransaction(
      state.id,
      state.providerId,
      state.externalTransactionId,
      state.idempotencyKey,
      state.payloadHash,
      state.walletId,
      state.playerId,
      state.roundId,
      state.gameId,
      state.kind,
      state.money,
      state.referenceExternalTransactionId,
      new Date(state.createdAt),
      state.status,
      state.referenceTransactionId,
      state.failureCode,
      state.processedAt === undefined ? undefined : new Date(state.processedAt),
    );
  }

  get status(): WagerTransactionStatus {
    return this._status;
  }

  get referenceTransactionId(): string | undefined {
    return this._referenceTransactionId;
  }

  get failureCode(): WagerTransactionFailureCode | undefined {
    return this._failureCode;
  }

  get createdAt(): Date {
    return new Date(this._createdAt);
  }

  get processedAt(): Date | undefined {
    return this._processedAt === undefined
      ? undefined
      : new Date(this._processedAt);
  }

  markProcessed(referenceTransactionId: string | undefined, at: Date): void {
    this.assertCanTransitionTo(WagerTransactionStatus.Processed);
    this.assertResolvedReference(referenceTransactionId);
    WagerTransaction.assertValidDate(at);

    this._status = WagerTransactionStatus.Processed;
    this._referenceTransactionId = referenceTransactionId;
    this._failureCode = undefined;
    this._processedAt = new Date(at);
  }

  markPendingReference(): void {
    this.assertCanTransitionTo(WagerTransactionStatus.PendingReference);

    if (this.referenceExternalTransactionId === undefined) {
      throw new InvalidWagerReferenceError(
        WagerReferenceFailureReason.Missing,
        'Only a transaction that declares a reference can wait for one',
      );
    }

    this._status = WagerTransactionStatus.PendingReference;
  }

  reject(code: WagerTransactionFailureCode): void {
    this.assertCanTransitionTo(WagerTransactionStatus.Rejected);
    this._status = WagerTransactionStatus.Rejected;
    this._failureCode = code;
  }

  fail(code: WagerTransactionFailureCode): void {
    this.assertCanTransitionTo(WagerTransactionStatus.Failed);
    this._status = WagerTransactionStatus.Failed;
    this._failureCode = code;
  }

  isTerminal(): boolean {
    return (
      this._status === WagerTransactionStatus.Processed ||
      this._status === WagerTransactionStatus.Rejected ||
      this._status === WagerTransactionStatus.Failed
    );
  }

  affectsBalance(): boolean {
    return this.kind !== WagerTransactionKind.Loss;
  }

  requiresReference(): boolean {
    return (
      this.kind === WagerTransactionKind.Refund ||
      this.kind === WagerTransactionKind.Rollback
    );
  }

  matchesPayload(payloadHash: string): boolean {
    return this.payloadHash === payloadHash;
  }

  ledgerDirectionFor(
    reference?: WagerTransaction,
  ): WalletMovementDirection {
    switch (this.kind) {
      case WagerTransactionKind.Opening:
      case WagerTransactionKind.Win:
      case WagerTransactionKind.Refund:
        if (
          this.kind !== WagerTransactionKind.Opening &&
          (this.referenceExternalTransactionId !== undefined || reference !== undefined)
        ) {
          this.assertValidReference(reference);
        }
        return WalletMovementDirection.Credit;

      case WagerTransactionKind.Bet:
        return WalletMovementDirection.Debit;

      case WagerTransactionKind.Loss:
        throw new InvalidWagerTransactionError(
          'LOSS does not affect the wallet balance or produce a ledger entry',
        );

      case WagerTransactionKind.Rollback: {
        this.assertValidReference(reference);
        const referenceDirection =
          reference.kind === WagerTransactionKind.Bet
            ? WalletMovementDirection.Debit
            : WalletMovementDirection.Credit;
        return referenceDirection === WalletMovementDirection.Debit
          ? WalletMovementDirection.Credit
          : WalletMovementDirection.Debit;
      }
    }
  }

  private assertCanTransitionTo(target: WagerTransactionStatus): void {
    const validTargets: Readonly<
      Record<WagerTransactionStatus, readonly WagerTransactionStatus[]>
    > = {
      [WagerTransactionStatus.Pending]: [
        WagerTransactionStatus.PendingReference,
        WagerTransactionStatus.Processed,
        WagerTransactionStatus.Rejected,
        WagerTransactionStatus.Failed,
      ],
      [WagerTransactionStatus.PendingReference]: [
        WagerTransactionStatus.Processed,
        WagerTransactionStatus.Rejected,
        WagerTransactionStatus.Failed,
      ],
      [WagerTransactionStatus.Processed]: [],
      [WagerTransactionStatus.Rejected]: [],
      [WagerTransactionStatus.Failed]: [],
    };

    if (!validTargets[this._status].includes(target)) {
      throw new InvalidTransactionStateError(this.id, this._status, target);
    }
  }

  private assertResolvedReference(
    referenceTransactionId: string | undefined,
  ): void {
    const declaresReference = this.referenceExternalTransactionId !== undefined;

    if (
      declaresReference &&
      !WagerTransaction.isNonBlank(referenceTransactionId)
    ) {
      throw new InvalidWagerReferenceError(
        WagerReferenceFailureReason.Missing,
        'A declared external reference must be resolved before processing',
      );
    }

    if (!declaresReference && referenceTransactionId !== undefined) {
      throw new InvalidWagerReferenceError(
        WagerReferenceFailureReason.ExternalTransactionMismatch,
        'A transaction without an external reference cannot link an internal reference',
      );
    }
  }

  private assertValidReference(
    reference?: WagerTransaction,
  ): asserts reference is WagerTransaction {
    if (reference === undefined) {
      throw new InvalidWagerReferenceError(
        WagerReferenceFailureReason.Missing,
        'The referenced transaction is required',
      );
    }

    if (
      this.referenceExternalTransactionId !== reference.externalTransactionId
    ) {
      throw new InvalidWagerReferenceError(
        WagerReferenceFailureReason.ExternalTransactionMismatch,
        'The resolved transaction does not match the external reference',
      );
    }

    if (reference.id === this.id) {
      throw new InvalidWagerReferenceError(
        WagerReferenceFailureReason.SelfReference,
        'A transaction cannot reference itself',
      );
    }

    if (reference.status !== WagerTransactionStatus.Processed) {
      throw new InvalidWagerReferenceError(
        WagerReferenceFailureReason.NotProcessed,
        'The referenced transaction must be processed',
      );
    }

    const matchingFields = [
      [
        this.providerId,
        reference.providerId,
        'provider',
        WagerReferenceFailureReason.ProviderMismatch,
      ],
      [
        this.playerId,
        reference.playerId,
        'player',
        WagerReferenceFailureReason.PlayerMismatch,
      ],
      [
        this.walletId,
        reference.walletId,
        'wallet',
        WagerReferenceFailureReason.WalletMismatch,
      ],
      [
        this.roundId,
        reference.roundId,
        'round',
        WagerReferenceFailureReason.RoundMismatch,
      ],
      [
        this.money.currency,
        reference.money.currency,
        'currency',
        WagerReferenceFailureReason.CurrencyMismatch,
      ],
    ] as const;

    for (const [currentValue, referenceValue, field, reason] of matchingFields) {
      if (currentValue !== referenceValue) {
        throw new InvalidWagerReferenceError(
          reason,
          `The referenced transaction belongs to a different ${field}`,
        );
      }
    }

    if (
      (this.kind === WagerTransactionKind.Refund ||
        this.kind === WagerTransactionKind.Rollback) &&
      !this.money.equals(reference.money)
    ) {
      throw new InvalidWagerReferenceError(
        WagerReferenceFailureReason.AmountMismatch,
        'A reversal amount must equal the referenced transaction amount',
      );
    }

    const allowedReferenceKinds: Partial<
      Readonly<Record<WagerTransactionKind, readonly WagerTransactionKind[]>>
    > = {
      [WagerTransactionKind.Win]: [WagerTransactionKind.Bet],
      [WagerTransactionKind.Refund]: [WagerTransactionKind.Bet],
      [WagerTransactionKind.Rollback]: [
        WagerTransactionKind.Bet,
        WagerTransactionKind.Win,
        WagerTransactionKind.Refund,
      ],
    };
    const allowedKinds = allowedReferenceKinds[this.kind];

    if (allowedKinds === undefined || !allowedKinds.includes(reference.kind)) {
      throw new InvalidWagerReferenceError(
        WagerReferenceFailureReason.KindNotAllowed,
        `${this.kind} cannot reference ${reference.kind}`,
      );
    }
  }

  private static assertExternalCreationProps(
    props: CreateWagerTransactionProps,
  ): void {
    WagerTransaction.assertRequiredIdentifiers({
      id: props.id,
      providerId: props.providerId,
      externalTransactionId: props.externalTransactionId,
      idempotencyKey: props.idempotencyKey,
      walletId: props.walletId,
      playerId: props.playerId,
      roundId: props.roundId,
      gameId: props.gameId,
    });
    WagerTransaction.assertPayloadHash(props.payloadHash);
    WagerTransaction.assertValidDate(props.at);

    if (props.kind === WagerTransactionKind.Opening) {
      throw new InvalidWagerTransactionError(
        'OPENING is internal and cannot be created by an external operation',
      );
    }

    if (!props.money.isPositive()) {
      throw new InvalidWagerTransactionError(
        'A wager transaction amount must be greater than zero',
      );
    }

    const hasReference = WagerTransaction.isNonBlank(
      props.referenceExternalTransactionId,
    );
    const allowsReference =
      props.kind === WagerTransactionKind.Win ||
      props.kind === WagerTransactionKind.Refund ||
      props.kind === WagerTransactionKind.Rollback;

    if (
      props.referenceExternalTransactionId !== undefined &&
      !hasReference
    ) {
      throw new InvalidWagerTransactionError(
        'A reference external transaction identifier cannot be blank',
      );
    }

    if (
      (props.kind === WagerTransactionKind.Refund ||
        props.kind === WagerTransactionKind.Rollback) &&
      !hasReference
    ) {
      throw new InvalidWagerTransactionError(
        `${props.kind} requires a reference external transaction identifier`,
      );
    }

    if (!allowsReference && hasReference) {
      throw new InvalidWagerTransactionError(
        `${props.kind} cannot declare a reference external transaction identifier`,
      );
    }
  }

  private static assertRequiredIdentifiers(
    identifiers: Readonly<Record<string, string>>,
  ): void {
    const blankEntry = Object.entries(identifiers).find(
      ([, value]) => !WagerTransaction.isNonBlank(value),
    );

    if (blankEntry !== undefined) {
      throw new InvalidWagerTransactionError(`${blankEntry[0]} is required`);
    }
  }

  private static assertPayloadHash(payloadHash: string): void {
    if (!/^[0-9a-f]{64}$/.test(payloadHash)) {
      throw new InvalidWagerTransactionError(
        'A wager transaction requires a lowercase SHA-256 payload hash',
      );
    }
  }

  private static assertValidDate(at: Date): void {
    if (Number.isNaN(at.getTime())) {
      throw new InvalidWagerTransactionError(
        'A valid transaction date is required',
      );
    }
  }

  private static isNonBlank(value: string | undefined): value is string {
    return value !== undefined && value.trim().length > 0;
  }
}
