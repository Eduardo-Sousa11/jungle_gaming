import { GetQueueUrlCommand, type SQSClient } from '@aws-sdk/client-sqs';
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { SQS_CLIENT } from '../messaging/sqs.module';

@Injectable()
export class SqsHealthIndicator {
  private readonly queueName: string;

  constructor(
    @Inject(SQS_CLIENT) private readonly client: SQSClient,
    config: ConfigService,
  ) {
    this.queueName = config.get('WAGER_QUEUE_NAME', 'wager-transactions.fifo');
  }

  async check(): Promise<void> {
    await this.client.send(
      new GetQueueUrlCommand({
        QueueName: this.queueName,
      }),
    );
  }
}
