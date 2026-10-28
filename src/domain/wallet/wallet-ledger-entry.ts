import { Money } from '../shared/money/money';
import { InvalidLedgerEntryError } from './wallet.errors';
import { WalletMovementDirection } from './wallet';

export interface WalletLedgerEntryState {
  readonly id: string;
  readonly walletId: string;
  readonly transactionId: string;
  readonly direction: WalletMovementDirection;
  readonly money: Money;
  readonly balanceBefore: Money;
  readonly balanceAfter: Money;
  readonly createdAt: Date;
}

export class WalletLedgerEntry {
  private constructor(
    public readonly id: string,
    public readonly walletId: string,
    public readonly transactionId: string,
    public readonly direction: WalletMovementDirection,
    public readonly money: Money,
    public readonly balanceBefore: Money,
    public readonly balanceAfter: Money,
    private readonly _createdAt: Date,
  ) {
    Object.freeze(this);
  }

  static create(props: WalletLedgerEntryState): WalletLedgerEntry {
    if (
      props.id.length === 0 ||
      props.walletId.length === 0 ||
      props.transactionId.length === 0
    ) {
      throw new InvalidLedgerEntryError(
        'Ledger, wallet and transaction identifiers are required',
      );
    }

    if (!props.money.isPositive()) {
      throw new InvalidLedgerEntryError('Ledger amount must be greater than zero');
    }

    const entry = new WalletLedgerEntry(
      props.id,
      props.walletId,
      props.transactionId,
      props.direction,
      props.money,
      props.balanceBefore,
      props.balanceAfter,
      new Date(props.createdAt),
    );

    if (!entry.isBalanced()) {
      throw new InvalidLedgerEntryError(
        'Ledger balances do not match its direction and amount',
      );
    }

    return entry;
  }

  static rehydrate(state: WalletLedgerEntryState): WalletLedgerEntry {
    return new WalletLedgerEntry(
      state.id,
      state.walletId,
      state.transactionId,
      state.direction,
      state.money,
      state.balanceBefore,
      state.balanceAfter,
      new Date(state.createdAt),
    );
  }

  get createdAt(): Date {
    return new Date(this._createdAt);
  }

  isBalanced(): boolean {
    try {
      const calculatedBalance =
        this.direction === WalletMovementDirection.Debit
          ? this.balanceBefore.subtract(this.money)
          : this.balanceBefore.add(this.money);

      return (
        !this.balanceBefore.isNegative() &&
        !this.balanceAfter.isNegative() &&
        calculatedBalance.equals(this.balanceAfter)
      );
    } catch {
      return false;
    }
  }
}
