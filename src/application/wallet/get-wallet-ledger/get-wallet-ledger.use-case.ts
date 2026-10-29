import { WalletNotFoundError } from '../get-wallet/get-wallet.errors';
import {
  InvalidLedgerCursorError,
  InvalidLedgerPageLimitError,
} from './get-wallet-ledger.errors';
import type { LedgerCursorCodec } from './ledger-cursor.codec';
import type {
  WalletLedgerEntryView,
  WalletLedgerQueryRepository,
} from './wallet-ledger-query.repository';

export const DEFAULT_LEDGER_PAGE_LIMIT = 50;
export const MAX_LEDGER_PAGE_LIMIT = 100;

export interface GetWalletLedgerInput {
  readonly walletId: string;
  readonly cursor?: string;
  readonly limit?: number;
}

export interface GetWalletLedgerOutput {
  readonly items: readonly WalletLedgerEntryView[];
  readonly nextCursor?: string;
}

export class GetWalletLedgerUseCase {
  constructor(
    private readonly repository: WalletLedgerQueryRepository,
    private readonly cursorCodec: LedgerCursorCodec,
  ) {}

  async execute(input: GetWalletLedgerInput): Promise<GetWalletLedgerOutput> {
    const limit = input.limit ?? DEFAULT_LEDGER_PAGE_LIMIT;
    if (
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > MAX_LEDGER_PAGE_LIMIT
    ) {
      throw new InvalidLedgerPageLimitError(limit);
    }

    const decodedCursor =
      input.cursor === undefined ? undefined : this.cursorCodec.decode(input.cursor);
    if (
      decodedCursor !== undefined &&
      decodedCursor.walletId !== input.walletId
    ) {
      throw new InvalidLedgerCursorError(
        'O cursor do ledger pertence a outra carteira',
      );
    }

    const page = await this.repository.findPage({
      walletId: input.walletId,
      limit,
      ...(decodedCursor === undefined
        ? {}
        : {
            after: {
              createdAt: decodedCursor.createdAt,
              entryId: decodedCursor.entryId,
            },
          }),
    });
    if (page === undefined) {
      throw new WalletNotFoundError(input.walletId);
    }

    const lastEntry = page.entries.at(-1);
    const nextCursor =
      page.hasMore && lastEntry !== undefined
        ? this.cursorCodec.encode({
            walletId: input.walletId,
            createdAt: new Date(lastEntry.createdAt),
            entryId: lastEntry.id,
          })
        : undefined;

    return Object.freeze({
      items: Object.freeze([...page.entries]),
      ...(nextCursor === undefined ? {} : { nextCursor }),
    });
  }
}
