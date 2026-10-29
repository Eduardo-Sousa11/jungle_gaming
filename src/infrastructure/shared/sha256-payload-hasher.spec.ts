import { describe, expect, test } from 'bun:test';

import { Sha256PayloadHasher } from './sha256-payload-hasher';

describe('Sha256PayloadHasher', () => {
  test('produz o mesmo hash independentemente da ordem das chaves do objeto', () => {
    const hasher = new Sha256PayloadHasher();

    const first = hasher.hash({
      playerId: 'player-1',
      money: { currency: 'BRL', amount: '100.00' },
      kind: 'OPENING',
    });
    const second = hasher.hash({
      kind: 'OPENING',
      money: { amount: '100.00', currency: 'BRL' },
      playerId: 'player-1',
    });

    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
  });

  test('produz um hash diferente para outro payload de negócio', () => {
    const hasher = new Sha256PayloadHasher();

    expect(hasher.hash({ amount: '100.00' })).not.toBe(
      hasher.hash({ amount: '100.01' }),
    );
  });
});
