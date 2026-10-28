import type { WalletLedgerCursorPosition } from './wallet-ledger-query.repository';

export const LEDGER_CURSOR_CODEC = Symbol('LEDGER_CURSOR_CODEC');

export interface LedgerCursorPayload extends WalletLedgerCursorPosition {
  readonly walletId: string;
}

export interface LedgerCursorCodec {
  encode(payload: LedgerCursorPayload): string;
  decode(cursor: string): LedgerCursorPayload;
}
