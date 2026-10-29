import { Injectable } from '@nestjs/common';

import { InvalidLedgerCursorError } from '../../application/wallet/get-wallet-ledger/get-wallet-ledger.errors';
import type {
  LedgerCursorCodec,
  LedgerCursorPayload,
} from '../../application/wallet/get-wallet-ledger/ledger-cursor.codec';

interface SerializedLedgerCursor {
  readonly v: 1;
  readonly w: string;
  readonly t: string;
  readonly i: string;
}

const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_CURSOR_LENGTH = 1024;

@Injectable()
export class Base64UrlLedgerCursorCodec implements LedgerCursorCodec {
  encode(payload: LedgerCursorPayload): string {
    const serialized: SerializedLedgerCursor = {
      v: 1,
      w: payload.walletId,
      t: payload.createdAt.toISOString(),
      i: payload.entryId,
    };
    return Buffer.from(JSON.stringify(serialized), 'utf8').toString('base64url');
  }

  decode(cursor: string): LedgerCursorPayload {
    try {
      if (
        cursor.length === 0 ||
        cursor.length > MAX_CURSOR_LENGTH ||
        !BASE64URL_PATTERN.test(cursor)
      ) {
        throw new Error('Entrada Base64URL inválida');
      }

      const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
      if (Buffer.from(decoded, 'utf8').toString('base64url') !== cursor) {
        throw new Error('Entrada Base64URL não canônica');
      }

      const value: unknown = JSON.parse(decoded);
      if (!this.isSerializedCursor(value)) {
        throw new Error('Payload do cursor inválido');
      }

      const createdAt = new Date(value.t);
      if (
        Number.isNaN(createdAt.getTime()) ||
        createdAt.toISOString() !== value.t
      ) {
        throw new Error('Data e hora do cursor inválidas');
      }

      return Object.freeze({
        walletId: value.w,
        createdAt,
        entryId: value.i,
      });
    } catch (error) {
      if (error instanceof InvalidLedgerCursorError) {
        throw error;
      }
      throw new InvalidLedgerCursorError();
    }
  }

  private isSerializedCursor(value: unknown): value is SerializedLedgerCursor {
    if (typeof value !== 'object' || value === null) {
      return false;
    }

    const record = value as Readonly<Record<string, unknown>>;
    return (
      Object.keys(record).length === 4 &&
      record['v'] === 1 &&
      typeof record['w'] === 'string' &&
      UUID_PATTERN.test(record['w']) &&
      typeof record['t'] === 'string' &&
      typeof record['i'] === 'string' &&
      UUID_PATTERN.test(record['i'])
    );
  }
}
