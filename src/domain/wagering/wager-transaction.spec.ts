import { describe, expect, test } from 'bun:test';

import { Money } from '../shared/money/money';
import { WalletMovementDirection } from '../wallet/wallet';
import {
  InvalidTransactionStateError,
  InvalidWagerReferenceError,
  InvalidWagerTransactionError,
} from './wager-transaction.errors';
import {
  type CreateWagerTransactionProps,
  WagerTransaction,
  WagerTransactionFailureCode,
  WagerTransactionKind,
  WagerTransactionStatus,
} from './wager-transaction';

const CREATED_AT = new Date('2026-10-27T10:00:00.000Z');
const PROCESSED_AT = new Date('2026-10-27T10:01:00.000Z');
const PAYLOAD_HASH = 'a'.repeat(64);

const BASE_PROPS: CreateWagerTransactionProps = {
  id: 'transaction-1',
  providerId: 'provider-a',
  externalTransactionId: 'external-1',
  idempotencyKey: 'provider-a:external-1',
  payloadHash: PAYLOAD_HASH,
  walletId: 'wallet-1',
  playerId: 'player-1',
  roundId: 'round-1',
  gameId: 'game-1',
  kind: WagerTransactionKind.Bet,
  money: Money.from({ amount: '25.00', currency: 'BRL' }),
  at: CREATED_AT,
};

describe('WagerTransaction creation', () => {
  test('creates an external transaction in PENDING', () => {
    const transaction = createTransaction();

    expect(transaction.status).toBe(WagerTransactionStatus.Pending);
    expect(transaction.isTerminal()).toBe(false);
    expect(transaction.failureCode).toBeUndefined();
    expect(transaction.referenceTransactionId).toBeUndefined();
    expect(transaction.processedAt).toBeUndefined();
    expect(transaction.createdAt).toEqual(CREATED_AT);
  });

  test('prevents external OPENING transactions', () => {
    expect(() =>
      createTransaction({ kind: WagerTransactionKind.Opening }),
    ).toThrow(InvalidWagerTransactionError);
  });

  test.each([
    WagerTransactionKind.Refund,
    WagerTransactionKind.Rollback,
  ])('%s requires an external reference', (kind) => {
    expect(() => createTransaction({ kind })).toThrow(
      InvalidWagerTransactionError,
    );
  });

  test.each([WagerTransactionKind.Bet, WagerTransactionKind.Loss])(
    '%s cannot declare an external reference',
    (kind) => {
      expect(() =>
        createTransaction({
          kind,
          referenceExternalTransactionId: 'referenced-1',
        }),
      ).toThrow(InvalidWagerTransactionError);
    },
  );

  test('allows WIN with or without a reference', () => {
    const withoutReference = createTransaction({
      kind: WagerTransactionKind.Win,
    });
    const withReference = createTransaction({
      kind: WagerTransactionKind.Win,
      referenceExternalTransactionId: 'bet-1',
    });

    expect(withoutReference.referenceExternalTransactionId).toBeUndefined();
    expect(withReference.referenceExternalTransactionId).toBe('bet-1');
  });

  test('prevents a transaction from referencing its own external identifier', () => {
    expect(() =>
      createTransaction({
        kind: WagerTransactionKind.Win,
        referenceExternalTransactionId: BASE_PROPS.externalTransactionId,
      }),
    ).toThrow(InvalidWagerTransactionError);
  });

  test('rejects a zero-value wagering transaction', () => {
    expect(() =>
      createTransaction({ money: Money.zero('BRL') }),
    ).toThrow(InvalidWagerTransactionError);
  });

  test('creates an internal processed OPENING transaction', () => {
    const transaction = WagerTransaction.createOpening({
      id: 'transaction-1',
      walletId: 'wallet-1',
      playerId: 'player-1',
      money: Money.from({ amount: '100.00', currency: 'BRL' }),
      payloadHash: PAYLOAD_HASH,
      at: CREATED_AT,
    });

    expect(transaction.kind).toBe(WagerTransactionKind.Opening);
    expect(transaction.status).toBe(WagerTransactionStatus.Processed);
    expect(transaction.isTerminal()).toBe(true);
    expect(transaction.providerId).toBe('__internal__');
    expect(transaction.externalTransactionId).toBe('opening:wallet-1');
    expect(transaction.idempotencyKey).toBe('__internal__:opening:wallet-1');
    expect(transaction.processedAt).toEqual(CREATED_AT);
  });

  test('rejects an OPENING transaction with zero balance', () => {
    expect(() =>
      WagerTransaction.createOpening({
        id: 'transaction-1',
        walletId: 'wallet-1',
        playerId: 'player-1',
        money: Money.zero('BRL'),
        payloadHash: PAYLOAD_HASH,
        at: CREATED_AT,
      }),
    ).toThrow(InvalidWagerTransactionError);
  });
});

describe('WagerTransaction state machine', () => {
  test('transitions from PENDING to PROCESSED', () => {
    const transaction = createTransaction();

    transaction.markProcessed(undefined, PROCESSED_AT);

    expect(transaction.status).toBe(WagerTransactionStatus.Processed);
    expect(transaction.isTerminal()).toBe(true);
    expect(transaction.processedAt).toEqual(PROCESSED_AT);
  });

  test('transitions from PENDING_REFERENCE to PROCESSED after resolving it', () => {
    const transaction = createTransaction({
      kind: WagerTransactionKind.Refund,
      referenceExternalTransactionId: 'bet-1',
    });

    transaction.markPendingReference();
    expect(transaction.status).toBe(WagerTransactionStatus.PendingReference);
    expect(transaction.isTerminal()).toBe(false);

    transaction.markProcessed('internal-bet-1', PROCESSED_AT);
    expect(transaction.status).toBe(WagerTransactionStatus.Processed);
    expect(transaction.referenceTransactionId).toBe('internal-bet-1');
  });

  test('does not process a declared reference before resolving it', () => {
    const transaction = createTransaction({
      kind: WagerTransactionKind.Rollback,
      referenceExternalTransactionId: 'bet-1',
    });

    expect(() => transaction.markProcessed(undefined, PROCESSED_AT)).toThrow(
      InvalidWagerReferenceError,
    );
    expect(transaction.status).toBe(WagerTransactionStatus.Pending);
  });

  test('does not attach an undeclared internal reference', () => {
    const transaction = createTransaction();

    expect(() =>
      transaction.markProcessed('unexpected-reference', PROCESSED_AT),
    ).toThrow(InvalidWagerReferenceError);
    expect(transaction.status).toBe(WagerTransactionStatus.Pending);
  });

  test('only transactions that declare a reference can wait for one', () => {
    const transaction = createTransaction();

    expect(() => transaction.markPendingReference()).toThrow(
      InvalidWagerReferenceError,
    );
    expect(transaction.status).toBe(WagerTransactionStatus.Pending);
  });

  test('transitions to REJECTED with an auditable failure code', () => {
    const transaction = createTransaction();

    transaction.reject(WagerTransactionFailureCode.InsufficientFunds);

    expect(transaction.status).toBe(WagerTransactionStatus.Rejected);
    expect(transaction.failureCode).toBe(
      WagerTransactionFailureCode.InsufficientFunds,
    );
    expect(transaction.isTerminal()).toBe(true);
  });

  test('transitions to FAILED with a permanent infrastructure code', () => {
    const transaction = createTransaction();

    transaction.fail(
      WagerTransactionFailureCode.PermanentInfrastructureFailure,
    );

    expect(transaction.status).toBe(WagerTransactionStatus.Failed);
    expect(transaction.failureCode).toBe(
      WagerTransactionFailureCode.PermanentInfrastructureFailure,
    );
    expect(transaction.isTerminal()).toBe(true);
  });

  test.each([
    WagerTransactionStatus.Processed,
    WagerTransactionStatus.Rejected,
    WagerTransactionStatus.Failed,
  ])('prevents every transition out of terminal state %s', (terminalStatus) => {
    const transaction = WagerTransaction.rehydrate({
      ...BASE_PROPS,
      status: terminalStatus,
      failureCode:
        terminalStatus === WagerTransactionStatus.Processed
          ? undefined
          : WagerTransactionFailureCode.ReferenceNotFound,
      processedAt:
        terminalStatus === WagerTransactionStatus.Processed
          ? PROCESSED_AT
          : undefined,
      createdAt: CREATED_AT,
    });

    expect(() =>
      transaction.markProcessed(undefined, PROCESSED_AT),
    ).toThrow(InvalidTransactionStateError);
    expect(() =>
      transaction.reject(WagerTransactionFailureCode.ReferenceNotFound),
    ).toThrow(InvalidTransactionStateError);
    expect(() =>
      transaction.fail(
        WagerTransactionFailureCode.PermanentInfrastructureFailure,
      ),
    ).toThrow(InvalidTransactionStateError);
    expect(() => transaction.markPendingReference()).toThrow(
      InvalidTransactionStateError,
    );
  });

  test('rehydrates persisted state without replaying transition rules', () => {
    const transaction = WagerTransaction.rehydrate({
      ...BASE_PROPS,
      status: WagerTransactionStatus.PendingReference,
      referenceExternalTransactionId: 'missing-1',
      createdAt: CREATED_AT,
    });

    expect(transaction.status).toBe(WagerTransactionStatus.PendingReference);
    expect(transaction.referenceExternalTransactionId).toBe('missing-1');
  });
});

describe('WagerTransaction domain queries', () => {
  test('matches the canonical payload hash exactly', () => {
    const transaction = createTransaction();

    expect(transaction.matchesPayload(PAYLOAD_HASH)).toBe(true);
    expect(transaction.matchesPayload('b'.repeat(64))).toBe(false);
  });

  test.each([
    [WagerTransactionKind.Bet, true],
    [WagerTransactionKind.Win, true],
    [WagerTransactionKind.Loss, false],
    [WagerTransactionKind.Refund, true],
    [WagerTransactionKind.Rollback, true],
  ])('%s affects balance: %s', (kind, expected) => {
    const referenceExternalTransactionId =
      kind === WagerTransactionKind.Refund ||
      kind === WagerTransactionKind.Rollback
        ? 'bet-1'
        : undefined;
    const transaction = createTransaction({
      kind,
      referenceExternalTransactionId,
    });

    expect(transaction.affectsBalance()).toBe(expected);
  });

  test.each([
    [WagerTransactionKind.Bet, false],
    [WagerTransactionKind.Win, false],
    [WagerTransactionKind.Loss, false],
    [WagerTransactionKind.Refund, true],
    [WagerTransactionKind.Rollback, true],
  ])('%s requires reference: %s', (kind, expected) => {
    const referenceExternalTransactionId = expected ? 'bet-1' : undefined;
    const transaction = createTransaction({
      kind,
      referenceExternalTransactionId,
    });

    expect(transaction.requiresReference()).toBe(expected);
  });

  test('maps BET and WIN to their ledger directions', () => {
    expect(createTransaction().ledgerDirectionFor()).toBe(
      WalletMovementDirection.Debit,
    );
    expect(
      createTransaction({ kind: WagerTransactionKind.Win }).ledgerDirectionFor(),
    ).toBe(WalletMovementDirection.Credit);
  });

  test('does not define a ledger direction for LOSS', () => {
    const loss = createTransaction({ kind: WagerTransactionKind.Loss });

    expect(() => loss.ledgerDirectionFor()).toThrow(
      InvalidWagerTransactionError,
    );
  });

  test('validates a REFUND reference and returns CREDIT', () => {
    const bet = createProcessedReference(WagerTransactionKind.Bet, {
      externalTransactionId: 'bet-1',
    });
    const refund = createTransaction({
      id: 'refund-1',
      externalTransactionId: 'refund-1',
      idempotencyKey: 'provider-a:refund-1',
      kind: WagerTransactionKind.Refund,
      referenceExternalTransactionId: 'bet-1',
    });

    expect(refund.ledgerDirectionFor(bet)).toBe(
      WalletMovementDirection.Credit,
    );
  });

  test.each([
    [WagerTransactionKind.Bet, WalletMovementDirection.Credit],
    [WagerTransactionKind.Win, WalletMovementDirection.Debit],
    [WagerTransactionKind.Refund, WalletMovementDirection.Debit],
  ])('ROLLBACK inverts a processed %s', (referenceKind, expected) => {
    const referenceExternalTransactionId = `${referenceKind.toLowerCase()}-1`;
    const reference = createProcessedReference(referenceKind, {
      id: `internal-${referenceExternalTransactionId}`,
      externalTransactionId: referenceExternalTransactionId,
      referenceExternalTransactionId:
        referenceKind === WagerTransactionKind.Refund ? 'original-bet' : undefined,
    });
    const rollback = createTransaction({
      id: 'rollback-1',
      externalTransactionId: 'rollback-1',
      idempotencyKey: 'provider-a:rollback-1',
      kind: WagerTransactionKind.Rollback,
      referenceExternalTransactionId,
    });

    expect(rollback.ledgerDirectionFor(reference)).toBe(expected);
  });

  test('rejects a resolved transaction that does not match the external reference', () => {
    const bet = createProcessedReference(WagerTransactionKind.Bet, {
      externalTransactionId: 'another-bet',
    });
    const refund = createTransaction({
      kind: WagerTransactionKind.Refund,
      referenceExternalTransactionId: 'bet-1',
    });

    expect(() => refund.ledgerDirectionFor(bet)).toThrow(
      InvalidWagerReferenceError,
    );
  });

  test.each([
    ['provider', { providerId: 'provider-b' }],
    ['player', { playerId: 'player-2' }],
    ['wallet', { walletId: 'wallet-2' }],
    ['round', { roundId: 'round-2' }],
    [
      'currency',
      { money: Money.from({ amount: '25.00', currency: 'USD' }) },
    ],
  ])('rejects a reference from another %s', (_field, referenceOverrides) => {
    const bet = createProcessedReference(WagerTransactionKind.Bet, {
      externalTransactionId: 'bet-1',
      ...referenceOverrides,
    });
    const refund = createTransaction({
      kind: WagerTransactionKind.Refund,
      referenceExternalTransactionId: 'bet-1',
    });

    expect(() => refund.ledgerDirectionFor(bet)).toThrow(
      InvalidWagerReferenceError,
    );
  });

  test('requires a processed reference of an allowed kind', () => {
    const pendingBet = createTransaction({
      externalTransactionId: 'bet-1',
    });
    const processedWin = createProcessedReference(WagerTransactionKind.Win, {
      externalTransactionId: 'bet-1',
    });
    const refund = createTransaction({
      kind: WagerTransactionKind.Refund,
      referenceExternalTransactionId: 'bet-1',
    });

    expect(() => refund.ledgerDirectionFor(pendingBet)).toThrow(
      InvalidWagerReferenceError,
    );
    expect(() => refund.ledgerDirectionFor(processedWin)).toThrow(
      InvalidWagerReferenceError,
    );
  });

  test('rejects a partial reversal', () => {
    const bet = createProcessedReference(WagerTransactionKind.Bet, {
      externalTransactionId: 'bet-1',
      money: Money.from({ amount: '50.00', currency: 'BRL' }),
    });
    const refund = createTransaction({
      kind: WagerTransactionKind.Refund,
      referenceExternalTransactionId: 'bet-1',
    });

    expect(() => refund.ledgerDirectionFor(bet)).toThrow(
      InvalidWagerReferenceError,
    );
  });
});

function createTransaction(
  overrides: Partial<CreateWagerTransactionProps> = {},
): WagerTransaction {
  return WagerTransaction.create({ ...BASE_PROPS, ...overrides });
}

function createProcessedReference(
  kind: WagerTransactionKind,
  overrides: Partial<CreateWagerTransactionProps> = {},
): WagerTransaction {
  const reference = createTransaction({
    kind,
    ...(kind === WagerTransactionKind.Refund
      ? { referenceExternalTransactionId: 'original-bet' }
      : {}),
    ...overrides,
  });
  reference.markProcessed(
    reference.referenceExternalTransactionId === undefined
      ? undefined
      : 'internal-original-bet',
    PROCESSED_AT,
  );
  return reference;
}
