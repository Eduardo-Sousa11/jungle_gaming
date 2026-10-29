import {
  DeleteMessageCommand,
  GetQueueUrlCommand,
  ReceiveMessageCommand,
  type Message,
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

import { SQS_CLIENT } from './sqs.module';
import { WagerSqsMessageHandler } from './wager-sqs-message.handler';
import { MetricsRegistry } from '../observability/metrics.registry';

@Injectable()
export class WagerSqsConsumer
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(WagerSqsConsumer.name);
  private readonly queueName: string;
  private readonly enabled: boolean;
  private queueUrl?: string;
  private running = false;
  private loopPromise?: Promise<void>;
  private pollAbort?: AbortController;
  private readonly inFlight = new Set<Promise<void>>();

  constructor(
    @Inject(SQS_CLIENT) private readonly client: SQSClient,
    private readonly handler: WagerSqsMessageHandler,
    private readonly metrics: MetricsRegistry,
    config: ConfigService,
  ) {
    this.queueName = config.get('WAGER_QUEUE_NAME', 'wager-transactions.fifo');
    this.enabled = config.get('WORKERS_ENABLED', 'false') === 'true';
  }

  onApplicationBootstrap(): void {
    if (!this.enabled) {
      return;
    }
    this.running = true;
    this.loopPromise = this.consumeLoop();
  }

  async onApplicationShutdown(): Promise<void> {
    this.running = false;
    this.pollAbort?.abort();
    await this.loopPromise;
    await Promise.allSettled([...this.inFlight]);
  }

  async pollOnce(waitTimeSeconds = 0): Promise<number> {
    const queueUrl = await this.resolveQueueUrl();
    this.pollAbort = new AbortController();
    const response = await this.client.send(
      new ReceiveMessageCommand({
        QueueUrl: queueUrl,
        MaxNumberOfMessages: 10,
        WaitTimeSeconds: waitTimeSeconds,
        MessageSystemAttributeNames: ['ApproximateReceiveCount'],
        MessageAttributeNames: ['All'],
      }),
      { abortSignal: this.pollAbort.signal },
    );
    const messages = response.Messages ?? [];
    await Promise.all(messages.map((message) => this.track(message, queueUrl)));
    return messages.length;
  }

  private async consumeLoop(): Promise<void> {
    while (this.running) {
      try {
        await this.pollOnce(10);
      } catch (error) {
        if (!this.running || isAbortError(error)) {
          return;
        }
        this.logger.error({
          event: 'falha_na_consulta_do_consumidor_sqs',
          errorCode: errorCode(error),
        });
        await new Promise<void>((resolve) => setTimeout(resolve, 1_000));
      }
    }
  }

  private track(message: Message, queueUrl: string): Promise<void> {
    const task = this.processMessage(message, queueUrl).finally(() => {
      this.inFlight.delete(task);
    });
    this.inFlight.add(task);
    return task;
  }

  private async processMessage(message: Message, queueUrl: string): Promise<void> {
    if (message.Body === undefined || message.ReceiptHandle === undefined) {
      return;
    }
    try {
      const result = await this.handler.handle(message.Body);
      await this.client.send(
        new DeleteMessageCommand({
          QueueUrl: queueUrl,
          ReceiptHandle: message.ReceiptHandle,
        }),
      );
      this.metrics.increment('wager_transactions_total', {
        source: 'sqs',
        status: result.status,
      });
      if (result.idempotentReplay) {
        this.metrics.increment('wager_duplicates_total', { source: 'sqs' });
      }
      this.logger.log({
        event: 'aposta_sqs_processada',
        messageId: message.MessageId,
        transactionId: result.transactionId,
        status: result.status,
        idempotentReplay: result.idempotentReplay,
      });
    } catch (error) {
      const receiveCount = Number.parseInt(
        message.Attributes?.ApproximateReceiveCount ?? '1',
        10,
      );
      this.metrics.increment('wager_retries_total', { component: 'consumer' });
      if (receiveCount >= 5) {
        this.metrics.increment('wager_dlq_total');
      }
      this.logger.warn({
        event: 'falha_no_processamento_da_aposta_sqs',
        messageId: message.MessageId,
        receiveCount,
        errorCode: errorCode(error),
      });
      // Sem ACK: o tempo de visibilidade permite nova tentativa e a política de redirecionamento envia à DLQ.
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

function errorCode(error: unknown): string {
  return error instanceof Error ? error.name : 'UNKNOWN_ERROR';
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}
