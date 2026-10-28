import { InsufficientWalletBalanceError } from '../wallet/wallet.errors';
import { WalletLedgerEntry } from '../wallet/wallet-ledger-entry';
import { type Wallet, WalletMovementDirection } from '../wallet/wallet';
import {
  InvalidTransactionStateError,
  InvalidWagerReferenceError,
  InvalidWagerTransactionError,
  WagerReferenceFailureReason,
} from './wager-transaction.errors';
import {
  type WagerTransaction,
  WagerTransactionFailureCode,
  WagerTransactionKind,
  WagerTransactionStatus,
} from './wager-transaction';

export interface ProcessWagerOperationInput {
  readonly transaction: WagerTransaction;
  readonly wallet: Wallet;
  readonly reference?: WagerTransaction;
  /** Informa se a mesma referência já foi revertida por este tipo de operação. */
  readonly sameKindReversalExists: boolean;
  readonly ledgerEntryId: string;
  readonly at: Date;
}

export interface ProcessWagerOperationResult {
  readonly status: WagerTransactionStatus;
  readonly ledgerEntry?: WalletLedgerEntry;
}

const REFERENCE_FAILURE_CODES: Readonly<
  Record<WagerReferenceFailureReason, WagerTransactionFailureCode>
> = {
  [WagerReferenceFailureReason.Missing]:
    WagerTransactionFailureCode.ReferenceNotFound,
  [WagerReferenceFailureReason.ExternalTransactionMismatch]:
    WagerTransactionFailureCode.ReferenceMismatch,
  [WagerReferenceFailureReason.SelfReference]:
    WagerTransactionFailureCode.ReferenceMismatch,
  [WagerReferenceFailureReason.NotProcessed]:
    WagerTransactionFailureCode.ReferenceNotProcessed,
  [WagerReferenceFailureReason.ProviderMismatch]:
    WagerTransactionFailureCode.ProviderMismatch,
  [WagerReferenceFailureReason.PlayerMismatch]:
    WagerTransactionFailureCode.PlayerMismatch,
  [WagerReferenceFailureReason.WalletMismatch]:
    WagerTransactionFailureCode.WalletMismatch,
  [WagerReferenceFailureReason.RoundMismatch]:
    WagerTransactionFailureCode.RoundMismatch,
  [WagerReferenceFailureReason.CurrencyMismatch]:
    WagerTransactionFailureCode.CurrencyMismatch,
  [WagerReferenceFailureReason.AmountMismatch]:
    WagerTransactionFailureCode.ReferenceAmountMismatch,
  [WagerReferenceFailureReason.KindNotAllowed]:
    WagerTransactionFailureCode.InvalidReferenceKind,
};

export class WagerOperationProcessor {
  process(input: ProcessWagerOperationInput): ProcessWagerOperationResult {
    const { transaction, wallet, reference, at } = input;

    this.assertProcessable(transaction, input.ledgerEntryId, at);

    const walletFailureCode = this.walletFailureCode(transaction, wallet);
    if (walletFailureCode !== undefined) {
      transaction.reject(walletFailureCode);
      return this.resultFor(transaction);
    }

    const declaresReference =
      transaction.referenceExternalTransactionId !== undefined;

    if (declaresReference && reference === undefined) {
      if (transaction.status === WagerTransactionStatus.Pending) {
        transaction.markPendingReference();
      }
      return this.resultFor(transaction);
    }

    if (!declaresReference && reference !== undefined) {
      transaction.reject(WagerTransactionFailureCode.ReferenceMismatch);
      return this.resultFor(transaction);
    }

    if (transaction.kind === WagerTransactionKind.Loss) {
      transaction.markProcessed(undefined, at);
      return this.resultFor(transaction);
    }

    let direction: WalletMovementDirection;
    try {
      direction = transaction.ledgerDirectionFor(reference);
    } catch (error) {
      if (!(error instanceof InvalidWagerReferenceError)) {
        throw error;
      }

      transaction.reject(REFERENCE_FAILURE_CODES[error.reason]);
      return this.resultFor(transaction);
    }

    if (transaction.requiresReference() && input.sameKindReversalExists) {
      transaction.reject(WagerTransactionFailureCode.ReferenceAlreadyReversed);
      return this.resultFor(transaction);
    }

    try {
      const balanceChange =
        direction === WalletMovementDirection.Debit
          ? wallet.debit(transaction.money, at)
          : wallet.credit(transaction.money, at);
      const ledgerEntry = WalletLedgerEntry.create({
        id: input.ledgerEntryId,
        walletId: wallet.id,
        transactionId: transaction.id,
        direction: balanceChange.direction,
        money: balanceChange.money,
        balanceBefore: balanceChange.balanceBefore,
        balanceAfter: balanceChange.balanceAfter,
        createdAt: balanceChange.occurredAt,
      });

      transaction.markProcessed(reference?.id, at);
      return this.resultFor(transaction, ledgerEntry);
    } catch (error) {
      if (!(error instanceof InsufficientWalletBalanceError)) {
        throw error;
      }

      const failureCode =
        transaction.kind === WagerTransactionKind.Bet
          ? WagerTransactionFailureCode.InsufficientFunds
          : WagerTransactionFailureCode.ReversalWouldMakeBalanceNegative;
      transaction.reject(failureCode);
      return this.resultFor(transaction);
    }
  }

  private assertProcessable(
    transaction: WagerTransaction,
    ledgerEntryId: string,
    at: Date,
  ): void {
    if (transaction.kind === WagerTransactionKind.Opening) {
      throw new InvalidWagerTransactionError(
        'OPENING is created only by the wallet opening flow',
      );
    }

    if (transaction.isTerminal()) {
      throw new InvalidTransactionStateError(
        transaction.id,
        transaction.status,
        WagerTransactionStatus.Processed,
      );
    }

    if (Number.isNaN(at.getTime())) {
      throw new InvalidWagerTransactionError(
        'A valid operation processing date is required',
      );
    }

    if (transaction.affectsBalance() && ledgerEntryId.trim().length === 0) {
      throw new InvalidWagerTransactionError(
        'A ledger entry identifier is required for a financial operation',
      );
    }
  }

  private walletFailureCode(
    transaction: WagerTransaction,
    wallet: Wallet,
  ): WagerTransactionFailureCode | undefined {
    if (transaction.walletId !== wallet.id) {
      return WagerTransactionFailureCode.WalletMismatch;
    }

    if (transaction.playerId !== wallet.playerId) {
      return WagerTransactionFailureCode.PlayerMismatch;
    }

    if (transaction.money.currency !== wallet.currency) {
      return WagerTransactionFailureCode.CurrencyMismatch;
    }

    return undefined;
  }

  private resultFor(
    transaction: WagerTransaction,
    ledgerEntry?: WalletLedgerEntry,
  ): ProcessWagerOperationResult {
    return Object.freeze({
      status: transaction.status,
      ...(ledgerEntry === undefined ? {} : { ledgerEntry }),
    });
  }
}
