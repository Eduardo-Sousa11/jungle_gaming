import { describe, expect, test } from 'bun:test';

import { InboxMessage } from './inbox-message';
import { WagerTransactionProcessed } from './wager-integration-events';
import { WagerTransactionKind } from '../wagering/wager-transaction';

describe('Messaging domain', () => {
  test('serializes a concrete and versioned integration event', () => {
    const event = WagerTransactionProcessed.create({
      eventId: 'event-1',
      aggregateId: 'transaction-1',
      correlationId: 'correlation-1',
      causationId: 'message-1',
      occurredAt: new Date('2026-10-28T12:00:00.000Z'),
      data: {
        transactionId: 'transaction-1',
        providerId: 'provider-a',
        externalTransactionId: 'external-1',
        walletId: 'wallet-1',
        kind: WagerTransactionKind.Loss,
        balance: { amount: '100.00', currency: 'BRL' },
      },
    });

    expect(event.toJSON()).toEqual({
      eventId: 'event-1',
      eventType: 'WagerTransactionProcessed',
      aggregateId: 'transaction-1',
      correlationId: 'correlation-1',
      causationId: 'message-1',
      occurredAt: '2026-10-28T12:00:00.000Z',
      version: 1,
      data: event.data,
    });
  });

  test('marks an inbox message exactly once', () => {
    const message = InboxMessage.receive({
      consumerName: 'consumer-a',
      messageId: 'message-1',
      payloadHash: 'a'.repeat(64),
      receivedAt: new Date('2026-10-28T12:00:00.000Z'),
    });

    message.markProcessed(new Date('2026-10-28T12:00:01.000Z'));
    message.markProcessed(new Date('2026-10-28T12:00:02.000Z'));

    expect(message.isProcessed()).toBe(true);
    expect(message.processedAt?.toISOString()).toBe(
      '2026-10-28T12:00:01.000Z',
    );
    expect(message.matchesPayload('a'.repeat(64))).toBe(true);
  });
});
