import { randomUUID } from 'node:crypto';

import {
  GetQueueUrlCommand,
  SendMessageCommand,
  type SQSClient,
} from '@aws-sdk/client-sqs';
import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { CLOCK, type Clock } from '../../application/shared/clock.port';
import {
  OUTBOX_REPOSITORY,
  type ClaimedOutboxMessage,
  type OutboxRepository,
} from '../../application/messaging/outbox/outbox.repository';
import { SQS_CLIENT } from './sqs.module';
import { MetricsRegistry } from '../observability/metrics.registry';

const LEASE_MILLISECONDS = 30_000;

@Injectable()
export class OutboxPublisher
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(OutboxPublisher.name);
  private readonly workerId = `outbox-${randomUUID()}`;
  private readonly queueName: string;
  private readonly enabled: boolean;
  private readonly pollInterval: number;
  private queueUrl?: string;
  private running = false;
  private loopPromise?: Promise<void>;

  constructor(
    @Inject(OUTBOX_REPOSITORY) private readonly repository: OutboxRepository,
    @Inject(SQS_CLIENT) private readonly client: SQSClient,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly metrics: MetricsRegistry,
    config: ConfigService,
  ) {
    this.queueName = config.get('WAGER_EVENTS_QUEUE_NAME', 'wager-events.fifo');
    this.enabled = config.get('WORKERS_ENABLED', 'false') === 'true';
    this.pollInterval = positiveInteger(
      config.get('OUTBOX_POLL_INTERVAL_MS', '500'),
      500,
    );
  }

  onApplicationBootstrap(): void {
    if (!this.enabled) {
      return;
    }
    this.running = true;
    this.loopPromise = this.publishLoop();
  }

  async onApplicationShutdown(): Promise<void> {
    this.running = false;
    await this.loopPromise;
  }

  async publishBatch(limit = 20): Promise<number> {
    const now = this.clock.now();
    const claimed = await this.repository.claimBatch({
      workerId: this.workerId,
      now,
      leaseExpiresBefore: new Date(now.getTime() - LEASE_MILLISECONDS),
      limit,
    });
    const oldest = await this.repository.oldestPendingOccurredAt();
    this.metrics.setGauge(
      'outbox_lag_seconds',
      oldest === undefined
        ? 0
        : Math.max(0, (now.getTime() - oldest.getTime()) / 1_000),
    );
    await Promise.all(claimed.map((message) => this.publishOne(message)));
    return claimed.length;
  }

  private async publishLoop(): Promise<void> {
    while (this.running) {
      try {
        const count = await this.publishBatch();
        if (count === 0) {
          await delay(this.pollInterval);
        }
      } catch (error) {
        this.logger.error({
          event: 'falha_no_lote_da_outbox',
          workerId: this.workerId,
          errorCode: errorCode(error),
        });
        await delay(this.pollInterval);
      }
    }
  }

  private async publishOne(message: ClaimedOutboxMessage): Promise<void> {
    try {
      const queueUrl = await this.resolveQueueUrl();
      await this.client.send(
        new SendMessageCommand({
          QueueUrl: queueUrl,
          MessageBody: JSON.stringify(message.payload),
          MessageGroupId: message.aggregateId,
          MessageDeduplicationId: message.id,
        }),
      );
      await this.repository.markPublished(
        message.id,
        this.workerId,
        this.clock.now(),
      );
      this.metrics.increment('outbox_published_total', {
        eventType: message.eventType,
      });
      this.logger.log({
        event: 'evento_da_outbox_publicado',
        eventId: message.id,
        eventType: message.eventType,
        aggregateId: message.aggregateId,
      });
    } catch (error) {
      const attempts = message.attempts + 1;
      this.metrics.increment('wager_retries_total', { component: 'outbox' });
      const backoffSeconds = Math.min(300, 2 ** Math.min(attempts, 8));
      await this.repository.scheduleRetry({
        id: message.id,
        workerId: this.workerId,
        nextAttemptAt: new Date(this.clock.now().getTime() + backoffSeconds * 1_000),
        errorCode: errorCode(error),
      });
      this.logger.warn({
        event: 'nova_tentativa_da_outbox_agendada',
        eventId: message.id,
        eventType: message.eventType,
        attempts,
        errorCode: errorCode(error),
      });
    }
  }

  private async resolveQueueUrl(): Promise<string> {
    if (this.queueUrl !== undefined) {
      return this.queueUrl;
    }
    const result = await this.client.send(
      new GetQueueUrlCommand({ QueueName: this.queueName }),
    );
    if (result.QueueUrl === undefined) {
      throw new Error(`A fila SQS ${this.queueName} não possui URL`);
    }
    this.queueUrl = result.QueueUrl;
    return result.QueueUrl;
  }
}

function positiveInteger(value: string, fallback: number): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function errorCode(error: unknown): string {
  return error instanceof Error ? error.name : 'UNKNOWN_ERROR';
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
