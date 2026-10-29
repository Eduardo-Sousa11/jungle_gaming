import { Money } from '../shared/money/money';
import {
  InsufficientWalletBalanceError,
  InvalidWalletError,
  NonPositiveWalletMovementError,
} from './wallet.errors';

export enum WalletMovementDirection {
  Debit = 'DEBIT',
  Credit = 'CREDIT',
}

export interface WalletState {
  readonly id: string;
  readonly playerId: string;
  readonly currency: string;
  readonly balance: Money;
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface WalletBalanceChange {
  readonly direction: WalletMovementDirection;
  readonly money: Money;
  readonly balanceBefore: Money;
  readonly balanceAfter: Money;
  readonly walletVersion: number;
  readonly occurredAt: Date;
}

export class Wallet {
  private constructor(
    public readonly id: string,
    public readonly playerId: string,
    public readonly currency: string,
    private _balance: Money,
    private _version: number,
    private readonly _createdAt: Date,
    private _updatedAt: Date,
  ) {}

  static open(props: {
    readonly id: string;
    readonly playerId: string;
    readonly initialBalance: Money;
    readonly at: Date;
  }): Wallet {
    if (props.id.length === 0 || props.playerId.length === 0) {
      throw new InvalidWalletError('Os identificadores da carteira e do jogador são obrigatórios');
    }

    if (props.initialBalance.isNegative()) {
      throw new InvalidWalletError('O saldo inicial da carteira não pode ser negativo');
    }

    return new Wallet(
      props.id,
      props.playerId,
      props.initialBalance.currency,
      props.initialBalance,
      1,
      new Date(props.at),
      new Date(props.at),
    );
  }

  static rehydrate(state: WalletState): Wallet {
    return new Wallet(
      state.id,
      state.playerId,
      state.currency,
      state.balance,
      state.version,
      new Date(state.createdAt),
      new Date(state.updatedAt),
    );
  }

  get balance(): Money {
    return this._balance;
  }

  get version(): number {
    return this._version;
  }

  get createdAt(): Date {
    return new Date(this._createdAt);
  }

  get updatedAt(): Date {
    return new Date(this._updatedAt);
  }

  credit(money: Money, at: Date): WalletBalanceChange {
    this.assertPositiveMovement(money);

    const balanceBefore = this._balance;
    const balanceAfter = balanceBefore.add(money);
    this.applyBalance(balanceAfter, at);

    return Object.freeze({
      direction: WalletMovementDirection.Credit,
      money,
      balanceBefore,
      balanceAfter,
      walletVersion: this._version,
      occurredAt: new Date(at),
    });
  }

  debit(money: Money, at: Date): WalletBalanceChange {
    this.assertPositiveMovement(money);

    if (this._balance.isLessThan(money)) {
      throw new InsufficientWalletBalanceError();
    }

    const balanceBefore = this._balance;
    const balanceAfter = balanceBefore.subtract(money);
    this.applyBalance(balanceAfter, at);

    return Object.freeze({
      direction: WalletMovementDirection.Debit,
      money,
      balanceBefore,
      balanceAfter,
      walletVersion: this._version,
      occurredAt: new Date(at),
    });
  }

  private applyBalance(balance: Money, at: Date): void {
    this._balance = balance;
    this._version += 1;
    this._updatedAt = new Date(at);
  }

  private assertPositiveMovement(money: Money): void {
    if (!money.isPositive()) {
      throw new NonPositiveWalletMovementError();
    }

    // A classe Money realiza a comparação definitiva entre as moedas.
    this._balance.add(money);
  }
}
