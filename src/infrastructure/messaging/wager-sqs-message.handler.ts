import { Inject, Injectable } from '@nestjs/common';

import { CLOCK, type Clock } from '../../application/shared/clock.port';
import {
  PAYLOAD_HASHER,
  type PayloadHasher,
} from '../../application/shared/payload-hasher.port';
import {
  type ProcessWagerTransactionOutput,
  ProcessWagerTransactionUseCase,
} from '../../application/wagering/process-wager-transaction/process-wager-transaction.use-case';
import { WagerTransactionKind } from '../../domain/wagering/wager-transaction';

export const WAGER_SQS_CONSUMER_NAME = 'wager-transactions-v1';

export class InvalidWagerSqsMessageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidWagerSqsMessageError';
  }
}

interface WagerSqsEnvelope {
  readonly messageId: string;
  readonly type: 'WagerTransactionRequested';
  readonly occurredAt: string;
  readonly data: {
    readonly providerId: string;
    readonly externalTransactionId: string;
    readonly idempotencyKey: string;
    readonly playerId: string;
    readonly walletId: string;
    readonly roundId: string;
    readonly gameId: string;
    readonly kind: WagerTransactionKind;
    readonly money: { readonly amount: string; readonly currency: string };
    readonly referenceExternalTransactionId?: string;
  };
}

@Injectable()
export class WagerSqsMessageHandler {
  constructor(
    private readonly processWager: ProcessWagerTransactionUseCase,
    @Inject(PAYLOAD_HASHER) private readonly payloadHasher: PayloadHasher,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async handle(body: string): Promise<ProcessWagerTransactionOutput> {
    const envelope = parseEnvelope(body);
    const payloadHash = this.payloadHasher.hash({ ...envelope });
    return this.processWager.execute(envelope.data, {
      correlationId: envelope.messageId,
      causationId: envelope.messageId,
      inbox: {
        consumerName: WAGER_SQS_CONSUMER_NAME,
        messageId: envelope.messageId,
        payloadHash,
        receivedAt: this.clock.now(),
      },
    });
  }
}

function parseEnvelope(body: string): WagerSqsEnvelope {
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    throw new InvalidWagerSqsMessageError('SQS message body is not valid JSON');
  }
  if (!isRecord(value) || !isRecord(value['data'])) {
    throw new InvalidWagerSqsMessageError('SQS message envelope is invalid');
  }

  const data = value['data'];
  const occurredAt = value['occurredAt'];
  const kind = data['kind'];
  const money = data['money'];
  const requiredEnvelope =
    validString(value['messageId'], 255) &&
    value['type'] === 'WagerTransactionRequested' &&
    typeof occurredAt === 'string' &&
    !Number.isNaN(new Date(occurredAt).getTime());
  const requiredData =
    validString(data['providerId'], 100) &&
    validString(data['externalTransactionId'], 255) &&
    validString(data['idempotencyKey'], 255) &&
    validString(data['playerId'], 255) &&
    validString(data['walletId'], 255) &&
    validString(data['roundId'], 255) &&
    validString(data['gameId'], 255) &&
    typeof kind === 'string' &&
    [
      WagerTransactionKind.Bet,
      WagerTransactionKind.Win,
      WagerTransactionKind.Loss,
      WagerTransactionKind.Refund,
      WagerTransactionKind.Rollback,
    ].includes(kind as WagerTransactionKind) &&
    isRecord(money) &&
    typeof money['amount'] === 'string' &&
    typeof money['currency'] === 'string' &&
    (data['referenceExternalTransactionId'] === undefined ||
      validString(data['referenceExternalTransactionId'], 255));

  if (!requiredEnvelope || !requiredData) {
    throw new InvalidWagerSqsMessageError('SQS message fields are invalid');
  }

  return value as unknown as WagerSqsEnvelope;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validString(value: unknown, maxLength: number): value is string {
  return (
    typeof value === 'string' &&
    value.trim().length > 0 &&
    value.length <= maxLength
  );
}
