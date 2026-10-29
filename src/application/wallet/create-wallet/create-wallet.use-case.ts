import type { MoneyProps } from '../../../domain/shared/money/money';
import { Money } from '../../../domain/shared/money/money';
import { WagerTransaction } from '../../../domain/wagering/wager-transaction';
import { WalletLedgerEntry } from '../../../domain/wallet/wallet-ledger-entry';
import { Wallet, WalletMovementDirection } from '../../../domain/wallet/wallet';
import type { Clock } from '../../shared/clock.port';
import type { IdGenerator } from '../../shared/id-generator.port';
import type { PayloadHasher } from '../../shared/payload-hasher.port';
import type { WalletCreationRepository } from './wallet-creation.repository';
import { createWagerIntegrationEvents } from '../../wagering/process-wager-transaction/wager-integration-event.factory';

export interface CreateWalletInput {
  readonly playerId: string;
  readonly initialBalance: MoneyProps;
}

export interface CreateWalletOutput {
  readonly id: string;
  readonly playerId: string;
  readonly balance: MoneyProps;
  readonly version: number;
}

export class CreateWalletUseCase {
  constructor(
    private readonly repository: WalletCreationRepository,
    private readonly idGenerator: IdGenerator,
    private readonly clock: Clock,
    private readonly payloadHasher: PayloadHasher,
  ) {}

  async execute(input: CreateWalletInput): Promise<CreateWalletOutput> {
    const initialBalance = Money.from(input.initialBalance);
    const walletId = this.idGenerator.generate();
    const createdAt = this.clock.now();
    const wallet = Wallet.open({
      id: walletId,
      playerId: input.playerId,
      initialBalance,
      at: createdAt,
    });

    if (!initialBalance.isPositive()) {
      await this.repository.create({ wallet });
      return this.toOutput(wallet);
    }

    const transactionId = this.idGenerator.generate();
    const ledgerEntryId = this.idGenerator.generate();
    const payloadHash = this.payloadHasher.hash({
      kind: 'OPENING',
      money: initialBalance.toJSON(),
      playerId: input.playerId,
      walletId,
    });
    const openingTransaction = WagerTransaction.createOpening({
      id: transactionId,
      walletId,
      playerId: input.playerId,
      money: initialBalance,
      payloadHash,
      at: createdAt,
    });
    const ledgerEntry = WalletLedgerEntry.create({
      id: ledgerEntryId,
      walletId,
      transactionId,
      direction: WalletMovementDirection.Credit,
      money: initialBalance,
      balanceBefore: Money.zero(initialBalance.currency),
      balanceAfter: initialBalance,
      createdAt,
    });
    const events = createWagerIntegrationEvents({
      transaction: openingTransaction,
      wallet,
      ledgerEntry,
      responseSnapshot: {
        transactionId: openingTransaction.id,
        status: openingTransaction.status,
        balance: wallet.balance.toJSON(),
      },
      occurredAt: createdAt,
      context: { correlationId: openingTransaction.id },
    });

    await this.repository.create({
      wallet,
      openingTransaction,
      ledgerEntry,
      events,
    });

    return this.toOutput(wallet);
  }

  private toOutput(wallet: Wallet): CreateWalletOutput {
    return Object.freeze({
      id: wallet.id,
      playerId: wallet.playerId,
      balance: wallet.balance.toJSON(),
      version: wallet.version,
    });
  }
}
