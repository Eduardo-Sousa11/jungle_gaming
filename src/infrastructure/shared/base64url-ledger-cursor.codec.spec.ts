import { describe, expect, test } from 'bun:test';

import { InvalidLedgerCursorError } from '../../application/wallet/get-wallet-ledger/get-wallet-ledger.errors';
import { Base64UrlLedgerCursorCodec } from './base64url-ledger-cursor.codec';

const payload = {
  walletId: '0192f291-27dd-7d3f-8071-5f8685deef37',
  entryId: '0192f298-345e-7e38-af88-e43f851a819d',
  createdAt: new Date('2026-10-28T12:34:56.789Z'),
};

describe('Base64UrlLedgerCursorCodec', () => {
  test('round-trips a versioned cursor without exposing raw JSON', () => {
    const codec = new Base64UrlLedgerCursorCodec();

    const cursor = codec.encode(payload);
    const decoded = codec.decode(cursor);

    expect(cursor).not.toContain('{');
    expect(cursor).not.toContain(payload.walletId);
    expect(decoded).toEqual(payload);
  });

  test.each([
    '',
    'not+base64url',
    Buffer.from('{}').toString('base64url'),
    Buffer.from(
      JSON.stringify({
        v: 2,
        w: payload.walletId,
        t: payload.createdAt.toISOString(),
        i: payload.entryId,
      }),
    ).toString('base64url'),
    Buffer.from(
      JSON.stringify({
        v: 1,
        w: payload.walletId,
        t: 'not-a-date',
        i: payload.entryId,
      }),
    ).toString('base64url'),
  ])('rejects a malformed or unsupported cursor: %s', (cursor) => {
    const codec = new Base64UrlLedgerCursorCodec();

    expect(() => codec.decode(cursor)).toThrow(InvalidLedgerCursorError);
  });
});
