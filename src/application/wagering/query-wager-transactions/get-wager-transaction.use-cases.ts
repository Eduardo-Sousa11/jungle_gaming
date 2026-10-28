import { WagerTransactionNotFoundError } from './wager-transaction-query.errors';
import type {
  WagerTransactionQueryRepository,
  WagerTransactionView,
} from './wager-transaction-query.repository';

export class GetWagerTransactionByIdUseCase {
  constructor(private readonly repository: WagerTransactionQueryRepository) {}

  async execute(transactionId: string): Promise<WagerTransactionView> {
    const transaction = await this.repository.findById(transactionId);
    if (transaction === undefined) {
      throw new WagerTransactionNotFoundError();
    }
    return transaction;
  }
}

export class GetWagerTransactionByProviderUseCase {
  constructor(private readonly repository: WagerTransactionQueryRepository) {}

  async execute(
    providerId: string,
    externalTransactionId: string,
  ): Promise<WagerTransactionView> {
    const transaction = await this.repository.findByProviderAndExternalId(
      providerId,
      externalTransactionId,
    );
    if (transaction === undefined) {
      throw new WagerTransactionNotFoundError();
    }
    return transaction;
  }
}
