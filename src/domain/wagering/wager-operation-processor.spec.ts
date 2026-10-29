import { describe, expect, test } from 'bun:test';

import { Money } from '../shared/money/money';
import { WalletMovementDirection, Wallet } from '../wallet/wallet';
import {
  InvalidTransactionStateError,
  InvalidWagerTransactionError,
} from './wager-transaction.errors';
import {
  type ProcessWagerOperationInput,
  WagerOperationProcessor,
} from './wager-operation-processor';
import {
  type CreateWagerTransactionProps,
  WagerTransaction,
  WagerTransactionFailureCode,
  WagerTransactionKind,
  WagerTransactionStatus,
} from './wager-transaction';

const CREATED_AT = new Date('2026-10-27T12:00:00.000Z');
const PROCESSED_AT = new Date('2026-10-27T12:01:00.000Z');
const PAYLOAD_HASH = 'a'.repeat(64);
const processor = new WagerOperationProcessor();

const BASE_TRANSACTION_PROPS: CreateWagerTransactionProps = {
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

describe('Matriz de operações de WagerOperationProcessor', () => {
  test('processa BET como débito com um lançamento no ledger', () => {
    const wallet = openWallet('100.00');
    const transaction = createTransaction(WagerTransactionKind.Bet);

    const result = process(transaction, wallet);

    expect(result.status).toBe(WagerTransactionStatus.Processed);
    expect(transaction.processedAt).toEqual(PROCESSED_AT);
    expect(wallet.balance.toJSON().amount).toBe('75.00');
    expect(wallet.version).toBe(2);
    expect(result.ledgerEntry?.direction).toBe(WalletMovementDirection.Debit);
    expect(result.ledgerEntry?.balanceBefore.toJSON().amount).toBe('100.00');
    expect(result.ledgerEntry?.balanceAfter.toJSON().amount).toBe('75.00');
  });

  test('rejeita BET com saldo insuficiente sem alterar saldo ou ledger', () => {
    const wallet = openWallet('20.00');
    const transaction = createTransaction(WagerTransactionKind.Bet);

    const result = process(transaction, wallet);

    expect(result.status).toBe(WagerTransactionStatus.Rejected);
    expect(transaction.failureCode).toBe(
      WagerTransactionFailureCode.InsufficientFunds,
    );
    expect(wallet.balance.toJSON().amount).toBe('20.00');
    expect(wallet.version).toBe(1);
    expect(result.ledgerEntry).toBeUndefined();
  });

  test('processa WIN como crédito', () => {
    const wallet = openWallet('100.00');
    const transaction = createTransaction(WagerTransactionKind.Win);

    const result = process(transaction, wallet);

    expect(result.status).toBe(WagerTransactionStatus.Processed);
    expect(wallet.balance.toJSON().amount).toBe('125.00');
    expect(wallet.version).toBe(2);
    expect(result.ledgerEntry?.direction).toBe(WalletMovementDirection.Credit);
  });

  test('processa WIN referenciando BET sem exigir valores iguais', () => {
    const wallet = openWallet('100.00');
    const bet = processedReference(WagerTransactionKind.Bet, {
      money: Money.from({ amount: '10.00', currency: 'BRL' }),
    });
    const win = createTransaction(WagerTransactionKind.Win, {
      referenceExternalTransactionId: bet.externalTransactionId,
    });

    const result = process(win, wallet, { reference: bet });

    expect(result.status).toBe(WagerTransactionStatus.Processed);
    expect(win.referenceTransactionId).toBe(bet.id);
    expect(wallet.balance.toJSON().amount).toBe('125.00');
  });

  test('processa LOSS sem alterar a carteira ou criar lançamento no ledger', () => {
    const wallet = openWallet('100.00');
    const transaction = createTransaction(WagerTransactionKind.Loss);

    const result = process(transaction, wallet, { ledgerEntryId: '' });

    expect(result.status).toBe(WagerTransactionStatus.Processed);
    expect(wallet.balance.toJSON().amount).toBe('100.00');
    expect(wallet.version).toBe(1);
    expect(result.ledgerEntry).toBeUndefined();
  });

  test('processa REFUND de uma BET processada como crédito', () => {
    const wallet = openWallet('75.00');
    const bet = processedReference(WagerTransactionKind.Bet);
    const refund = createReversal(WagerTransactionKind.Refund, bet);

    const result = process(refund, wallet, { reference: bet });

    expect(result.status).toBe(WagerTransactionStatus.Processed);
    expect(refund.referenceTransactionId).toBe(bet.id);
    expect(wallet.balance.toJSON().amount).toBe('100.00');
    expect(result.ledgerEntry?.direction).toBe(WalletMovementDirection.Credit);
  });

  test.each([
    [WagerTransactionKind.Bet, '75.00', '100.00', WalletMovementDirection.Credit],
    [WagerTransactionKind.Win, '100.00', '75.00', WalletMovementDirection.Debit],
    [
      WagerTransactionKind.Refund,
      '100.00',
      '75.00',
      WalletMovementDirection.Debit,
    ],
  ])(
    'processa ROLLBACK de %s com o efeito financeiro inverso',
    (referenceKind, initialBalance, expectedBalance, expectedDirection) => {
      const wallet = openWallet(initialBalance);
      const reference = processedReference(referenceKind);
      const rollback = createReversal(WagerTransactionKind.Rollback, reference);

      const result = process(rollback, wallet, { reference });

      expect(result.status).toBe(WagerTransactionStatus.Processed);
      expect(rollback.referenceTransactionId).toBe(reference.id);
      expect(wallet.balance.toJSON().amount).toBe(expectedBalance);
      expect(result.ledgerEntry?.direction).toBe(expectedDirection);
    },
  );

  test('rejeita ROLLBACK de débito que tornaria a carteira negativa', () => {
    const wallet = openWallet('10.00');
    const win = processedReference(WagerTransactionKind.Win);
    const rollback = createReversal(WagerTransactionKind.Rollback, win);

    const result = process(rollback, wallet, { reference: win });

    expect(result.status).toBe(WagerTransactionStatus.Rejected);
    expect(rollback.failureCode).toBe(
      WagerTransactionFailureCode.ReversalWouldMakeBalanceNegative,
    );
    expect(wallet.balance.toJSON().amount).toBe('10.00');
    expect(wallet.version).toBe(1);
    expect(result.ledgerEntry).toBeUndefined();
  });
});

describe('Referências e rejeições de WagerOperationProcessor', () => {
  test.each([WagerTransactionKind.Win, WagerTransactionKind.Refund, WagerTransactionKind.Rollback])(
    'move %s com referência declarada ausente para PENDING_REFERENCE',
    (kind) => {
      const wallet = openWallet('100.00');
      const transaction = createTransaction(kind, {
        referenceExternalTransactionId: 'reference-1',
      });

      const result = process(transaction, wallet);

      expect(result.status).toBe(WagerTransactionStatus.PendingReference);
      expect(transaction.failureCode).toBeUndefined();
      expect(wallet.balance.toJSON().amount).toBe('100.00');
      expect(wallet.version).toBe(1);
      expect(result.ledgerEntry).toBeUndefined();
    },
  );

  test('processa uma transação PENDING_REFERENCE quando a referência chega', () => {
    const wallet = openWallet('75.00');
    const bet = processedReference(WagerTransactionKind.Bet);
    const refund = createReversal(WagerTransactionKind.Refund, bet);

    const pendingResult = process(refund, wallet);
    const processedResult = process(refund, wallet, { reference: bet });

    expect(pendingResult.status).toBe(WagerTransactionStatus.PendingReference);
    expect(processedResult.status).toBe(WagerTransactionStatus.Processed);
    expect(wallet.balance.toJSON().amount).toBe('100.00');
    expect(processedResult.ledgerEntry).toBeDefined();
  });

  test('rejeita uma reversão repetida do mesmo tipo sem efeito financeiro', () => {
    const wallet = openWallet('75.00');
    const bet = processedReference(WagerTransactionKind.Bet);
    const refund = createReversal(WagerTransactionKind.Refund, bet);

    const result = process(refund, wallet, {
      reference: bet,
      sameKindReversalExists: true,
    });

    expect(result.status).toBe(WagerTransactionStatus.Rejected);
    expect(refund.failureCode).toBe(
      WagerTransactionFailureCode.ReferenceAlreadyReversed,
    );
    expect(wallet.balance.toJSON().amount).toBe('75.00');
    expect(wallet.version).toBe(1);
    expect(result.ledgerEntry).toBeUndefined();
  });

  test.each([
    ['provedor', { providerId: 'provider-b' }, WagerTransactionFailureCode.ProviderMismatch],
    ['jogador', { playerId: 'player-2' }, WagerTransactionFailureCode.PlayerMismatch],
    ['carteira', { walletId: 'wallet-2' }, WagerTransactionFailureCode.WalletMismatch],
    ['rodada', { roundId: 'round-2' }, WagerTransactionFailureCode.RoundMismatch],
    [
      'moeda',
      { money: Money.from({ amount: '25.00', currency: 'USD' }) },
      WagerTransactionFailureCode.CurrencyMismatch,
    ],
  ])(
    'rejeita uma referência de outro(a) %s com código de falha estável',
    (_field, referenceOverrides, expectedFailureCode) => {
      const wallet = openWallet('75.00');
      const bet = processedReference(WagerTransactionKind.Bet, referenceOverrides);
      const refund = createTransaction(WagerTransactionKind.Refund, {
        referenceExternalTransactionId: bet.externalTransactionId,
      });

      const result = process(refund, wallet, { reference: bet });

      expect(result.status).toBe(WagerTransactionStatus.Rejected);
      expect(refund.failureCode).toBe(expectedFailureCode);
      expect(wallet.balance.toJSON().amount).toBe('75.00');
      expect(result.ledgerEntry).toBeUndefined();
    },
  );

  test('rejeita uma reversão parcial com um código de falha estável', () => {
    const wallet = openWallet('75.00');
    const bet = processedReference(WagerTransactionKind.Bet, {
      money: Money.from({ amount: '50.00', currency: 'BRL' }),
    });
    const refund = createTransaction(WagerTransactionKind.Refund, {
      referenceExternalTransactionId: bet.externalTransactionId,
    });

    const result = process(refund, wallet, { reference: bet });

    expect(result.status).toBe(WagerTransactionStatus.Rejected);
    expect(refund.failureCode).toBe(
      WagerTransactionFailureCode.ReferenceAmountMismatch,
    );
    expect(wallet.balance.toJSON().amount).toBe('75.00');
  });

  test('rejeita uma referência que não está processada', () => {
    const wallet = openWallet('75.00');
    const pendingBet = createTransaction(WagerTransactionKind.Bet, {
      id: 'reference-id',
      externalTransactionId: 'reference-1',
    });
    const refund = createReversal(WagerTransactionKind.Refund, pendingBet);

    const result = process(refund, wallet, { reference: pendingBet });

    expect(result.status).toBe(WagerTransactionStatus.Rejected);
    expect(refund.failureCode).toBe(
      WagerTransactionFailureCode.ReferenceNotProcessed,
    );
  });

  test('rejeita uma referência de tipo não permitido pela operação', () => {
    const wallet = openWallet('75.00');
    const win = processedReference(WagerTransactionKind.Win);
    const refund = createReversal(WagerTransactionKind.Refund, win);

    const result = process(refund, wallet, { reference: win });

    expect(result.status).toBe(WagerTransactionStatus.Rejected);
    expect(refund.failureCode).toBe(
      WagerTransactionFailureCode.InvalidReferenceKind,
    );
  });

  test('rejeita uma referência inesperada em uma operação que não a declarou', () => {
    const wallet = openWallet('100.00');
    const bet = createTransaction(WagerTransactionKind.Bet);
    const unexpectedReference = processedReference(WagerTransactionKind.Bet);

    const result = process(bet, wallet, { reference: unexpectedReference });

    expect(result.status).toBe(WagerTransactionStatus.Rejected);
    expect(bet.failureCode).toBe(WagerTransactionFailureCode.ReferenceMismatch);
    expect(wallet.balance.toJSON().amount).toBe('100.00');
  });
});

describe('Contexto da carteira e segurança de WagerOperationProcessor', () => {
  test.each([
    [
      'carteira',
      { id: 'wallet-2' },
      WagerTransactionFailureCode.WalletMismatch,
    ],
    [
      'jogador',
      { playerId: 'player-2' },
      WagerTransactionFailureCode.PlayerMismatch,
    ],
    [
      'moeda',
      { currency: 'USD' },
      WagerTransactionFailureCode.CurrencyMismatch,
    ],
  ])(
    'rejeita uma transação para um(a) %s diferente',
    (_field, walletOverrides, expectedFailureCode) => {
      const wallet = openWallet('100.00', walletOverrides);
      const bet = createTransaction(WagerTransactionKind.Bet);

      const result = process(bet, wallet);

      expect(result.status).toBe(WagerTransactionStatus.Rejected);
      expect(bet.failureCode).toBe(expectedFailureCode);
      expect(wallet.balance.toJSON().amount).toBe('100.00');
      expect(wallet.version).toBe(1);
      expect(result.ledgerEntry).toBeUndefined();
    },
  );

  test('impede reprocessar uma transação terminal antes de alterar a carteira', () => {
    const wallet = openWallet('100.00');
    const bet = createTransaction(WagerTransactionKind.Bet);
    bet.markProcessed(undefined, PROCESSED_AT);

    expect(() => process(bet, wallet)).toThrow(InvalidTransactionStateError);
    expect(wallet.balance.toJSON().amount).toBe('100.00');
    expect(wallet.version).toBe(1);
  });

  test('não aceita OPENING no processador de operações de aposta', () => {
    const wallet = openWallet('100.00');
    const opening = WagerTransaction.createOpening({
      id: 'opening-1',
      walletId: wallet.id,
      playerId: wallet.playerId,
      money: Money.from({ amount: '100.00', currency: 'BRL' }),
      payloadHash: PAYLOAD_HASH,
      at: CREATED_AT,
    });

    expect(() => process(opening, wallet)).toThrow(
      InvalidWagerTransactionError,
    );
  });

  test('exige um identificador do ledger antes de alterar uma operação financeira', () => {
    const wallet = openWallet('100.00');
    const bet = createTransaction(WagerTransactionKind.Bet);

    expect(() => process(bet, wallet, { ledgerEntryId: ' ' })).toThrow(
      InvalidWagerTransactionError,
    );
    expect(wallet.balance.toJSON().amount).toBe('100.00');
    expect(wallet.version).toBe(1);
    expect(bet.status).toBe(WagerTransactionStatus.Pending);
  });
});

function openWallet(
  amount: string,
  overrides: Partial<{
    id: string;
    playerId: string;
    currency: string;
  }> = {},
): Wallet {
  const currency = overrides.currency ?? 'BRL';
  return Wallet.open({
    id: overrides.id ?? 'wallet-1',
    playerId: overrides.playerId ?? 'player-1',
    initialBalance: Money.from({ amount, currency }),
    at: CREATED_AT,
  });
}

function createTransaction(
  kind: WagerTransactionKind,
  overrides: Partial<CreateWagerTransactionProps> = {},
): WagerTransaction {
  const requiredReference =
    kind === WagerTransactionKind.Refund ||
    kind === WagerTransactionKind.Rollback
      ? { referenceExternalTransactionId: 'reference-1' }
      : {};

  return WagerTransaction.create({
    ...BASE_TRANSACTION_PROPS,
    kind,
    ...requiredReference,
    ...overrides,
  });
}

function processedReference(
  kind: WagerTransactionKind,
  overrides: Partial<CreateWagerTransactionProps> = {},
): WagerTransaction {
  const reference = createTransaction(kind, {
    id: 'reference-id',
    externalTransactionId: 'reference-1',
    idempotencyKey: 'provider-a:reference-1',
    ...(kind === WagerTransactionKind.Refund
      ? { referenceExternalTransactionId: 'original-bet' }
      : {}),
    ...overrides,
  });
  reference.markProcessed(
    reference.referenceExternalTransactionId === undefined
      ? undefined
      : 'original-bet-id',
    PROCESSED_AT,
  );
  return reference;
}

function createReversal(
  kind: WagerTransactionKind.Refund | WagerTransactionKind.Rollback,
  reference: WagerTransaction,
): WagerTransaction {
  return createTransaction(kind, {
    referenceExternalTransactionId: reference.externalTransactionId,
  });
}

function process(
  transaction: WagerTransaction,
  wallet: Wallet,
  overrides: Partial<
    Omit<ProcessWagerOperationInput, 'transaction' | 'wallet'>
  > = {},
) {
  return processor.process({
    transaction,
    wallet,
    sameKindReversalExists: false,
    ledgerEntryId: 'ledger-1',
    at: PROCESSED_AT,
    ...overrides,
  });
}
