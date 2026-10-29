import { randomUUID } from 'node:crypto';

import {
  ChangeMessageVisibilityCommand,
  CreateQueueCommand,
  DeleteQueueCommand,
  GetQueueAttributesCommand,
  ReceiveMessageCommand,
  SendMessageCommand,
  SetQueueAttributesCommand,
  type SQSClient,
} from '@aws-sdk/client-sqs';
import { MikroORM } from '@mikro-orm/postgresql';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import { AppModule } from '../../src/app.module';
import { CLOCK, type Clock } from '../../src/application/shared/clock.port';
import { ProcessWagerTransactionUseCase } from '../../src/application/wagering/process-wager-transaction/process-wager-transaction.use-case';
import { InboxPayloadConflictError } from '../../src/application/wagering/process-wager-transaction/process-wager-transaction.errors';
import { CreateWalletUseCase } from '../../src/application/wallet/create-wallet/create-wallet.use-case';
import {
  WagerTransactionFailureCode,
  WagerTransactionKind,
  WagerTransactionStatus,
} from '../../src/domain/wagering/wager-transaction';
import { InboxMessageRecord } from '../../src/infrastructure/persistence/entities/inbox-message.record';
import { OutboxMessageRecord } from '../../src/infrastructure/persistence/entities/outbox-message.record';
import { WalletLedgerEntryRecord } from '../../src/infrastructure/persistence/entities/wallet-ledger-entry.record';
import { WalletRecord } from '../../src/infrastructure/persistence/entities/wallet.record';
import { WagerTransactionRecord } from '../../src/infrastructure/persistence/entities/wager-transaction.record';
import { MikroOrmOutboxRepository } from '../../src/infrastructure/persistence/repositories/mikro-orm-outbox.repository';
import { OutboxPublisher } from '../../src/infrastructure/messaging/outbox.publisher';
import { PendingReferenceWorker } from '../../src/infrastructure/messaging/pending-reference.worker';
import { SQS_CLIENT } from '../../src/infrastructure/messaging/sqs.module';
import { WagerSqsConsumer } from '../../src/infrastructure/messaging/wager-sqs.consumer';
import {
  WAGER_SQS_CONSUMER_NAME,
  WagerSqsMessageHandler,
} from '../../src/infrastructure/messaging/wager-sqs-message.handler';
import { MetricsRegistry } from '../../src/infrastructure/observability/metrics.registry';

describe('Mensageria distribuída com PostgreSQL e LocalStack', () => {
  let app: INestApplication;
  let orm: MikroORM;
  let sqs: SQSClient;
  let handler: WagerSqsMessageHandler;
  let consumer: WagerSqsConsumer;
  let createWallet: CreateWalletUseCase;
  let processWager: ProcessWagerTransactionUseCase;
  let pendingWorker: PendingReferenceWorker;
  let queueUrl: string;
  let dlqUrl: string;
  let eventsQueueUrl: string;
  let testQueueNames: {
    readonly queue: string;
    readonly dlq: string;
    readonly events: string;
  };

  beforeAll(async () => {
    const suffix = randomUUID().slice(0, 8);
    testQueueNames = {
      queue: `wager-transactions-test-${suffix}.fifo`,
      dlq: `wager-transactions-dlq-test-${suffix}.fifo`,
      events: `wager-events-test-${suffix}.fifo`,
    };
    process.env.WORKERS_ENABLED = 'false';
    process.env.WAGER_QUEUE_NAME = testQueueNames.queue;
    process.env.WAGER_DLQ_NAME = testQueueNames.dlq;
    process.env.WAGER_EVENTS_QUEUE_NAME = testQueueNames.events;
    app = await NestFactory.create(AppModule, { logger: false });
    await app.init();
    orm = app.get(MikroORM);
    await orm.migrator.up();
    sqs = app.get(SQS_CLIENT);
    handler = app.get(WagerSqsMessageHandler);
    consumer = app.get(WagerSqsConsumer);
    createWallet = app.get(CreateWalletUseCase);
    processWager = app.get(ProcessWagerTransactionUseCase);
    pendingWorker = app.get(PendingReferenceWorker);
    dlqUrl = await createFifoQueue(testQueueNames.dlq);
    const dlqAttributes = await sqs.send(
      new GetQueueAttributesCommand({
        QueueUrl: dlqUrl,
        AttributeNames: ['QueueArn'],
      }),
    );
    const dlqArn = dlqAttributes.Attributes?.QueueArn;
    if (dlqArn === undefined) throw new Error('DLQ de teste sem ARN');
    queueUrl = await createFifoQueue(testQueueNames.queue, {
      VisibilityTimeout: '30',
      RedrivePolicy: JSON.stringify({
        deadLetterTargetArn: dlqArn,
        maxReceiveCount: 5,
      }),
    });
    eventsQueueUrl = await createFifoQueue(testQueueNames.events, {
      ContentBasedDeduplication: 'false',
    });
  });

  afterAll(async () => {
    await Promise.all(
      [queueUrl, dlqUrl, eventsQueueUrl].map((url) =>
        sqs.send(new DeleteQueueCommand({ QueueUrl: url })),
      ),
    );
    await app.close();
    delete process.env.WORKERS_ENABLED;
    delete process.env.WAGER_QUEUE_NAME;
    delete process.env.WAGER_DLQ_NAME;
    delete process.env.WAGER_EVENTS_QUEUE_NAME;
  });

  test('a reentrega após o commit reproduz pela inbox sem duplicar efeitos', async () => {
    const wallet = await openWallet('100.00');
    const messageId = randomUUID();
    const body = wagerMessage(wallet, { messageId });
    await sqs.send(
      new SendMessageCommand({
        QueueUrl: queueUrl,
        MessageBody: body,
        MessageGroupId: wallet.walletId,
        MessageDeduplicationId: messageId,
      }),
    );
    const received = await sqs.send(
      new ReceiveMessageCommand({
        QueueUrl: queueUrl,
        MaxNumberOfMessages: 1,
        WaitTimeSeconds: 1,
      }),
    );
    const message = received.Messages?.[0];
    if (message?.ReceiptHandle === undefined) {
      throw new Error('A mensagem de teste não foi recebida');
    }

    const first = await handler.handle(body);
    expect(first.idempotentReplay).toBe(false);
    await sqs.send(
      new ChangeMessageVisibilityCommand({
        QueueUrl: queueUrl,
        ReceiptHandle: message.ReceiptHandle,
        VisibilityTimeout: 0,
      }),
    );
    expect(await consumer.pollOnce(1)).toBe(1);

    const em = orm.em.fork();
    expect(
      await em.count(InboxMessageRecord, {
        consumerName: WAGER_SQS_CONSUMER_NAME,
        messageId,
      }),
    ).toBe(1);
    const inbox = await em.findOneOrFail(InboxMessageRecord, {
      consumerName: WAGER_SQS_CONSUMER_NAME,
      messageId,
    });
    expect(inbox.processedAt).not.toBeNull();
    expect(
      await em.count(WagerTransactionRecord, {
        providerId: 'provider-sqs',
        externalTransactionId: messageId,
      }),
    ).toBe(1);
    expect(
      await em.count(WalletLedgerEntryRecord, { walletId: wallet.walletId }),
    ).toBe(2);
    const storedWallet = await em.findOneOrFail(WalletRecord, {
      id: wallet.walletId,
    });
    expect(storedWallet.balance).toBe('75.00');
  });

  test('reverte a inbox quando o processamento financeiro não consegue confirmar', async () => {
    const messageId = randomUUID();
    const body = wagerMessage(
      { walletId: randomUUID(), playerId: randomUUID() },
      { messageId },
    );

    await expect(handler.handle(body)).rejects.toThrow();

    expect(
      await orm.em.fork().count(InboxMessageRecord, {
        consumerName: WAGER_SQS_CONSUMER_NAME,
        messageId,
      }),
    ).toBe(0);
  });

  test('rejeita um payload divergente para a mesma identidade da inbox', async () => {
    const wallet = await openWallet('100.00');
    const messageId = randomUUID();
    await handler.handle(wagerMessage(wallet, { messageId }));

    await expect(
      handler.handle(
        wagerMessage(wallet, { messageId, amount: '30.00' }),
      ),
    ).rejects.toBeInstanceOf(InboxPayloadConflictError);
  });

  test('dois publicadores reservam registros da outbox concorrentemente e recuperam uma concessão expirada', async () => {
    const wallet = await openWallet('10.00');
    const repositoryA = new MikroOrmOutboxRepository(orm.em.fork());
    const repositoryB = new MikroOrmOutboxRepository(orm.em.fork());
    const clock = app.get<Clock>(CLOCK);
    const config = app.get(ConfigService);
    const metrics = app.get(MetricsRegistry);
    const publisherA = new OutboxPublisher(
      repositoryA,
      sqs,
      clock,
      metrics,
      config,
    );
    const publisherB = new OutboxPublisher(
      repositoryB,
      sqs,
      clock,
      metrics,
      config,
    );

    const crashedClaim = await repositoryA.claimBatch({
      workerId: 'crashed-worker',
      now: new Date(),
      leaseExpiresBefore: new Date(0),
      limit: 1,
    });
    expect(crashedClaim).toHaveLength(1);
    await orm.em.fork().getConnection().execute(
      'update "outbox_messages" set "locked_at" = ? where "id" = ?',
      [new Date(0), crashedClaim[0]?.id],
    );

    for (let iteration = 0; iteration < 20; iteration += 1) {
      const [left, right] = await Promise.all([
        publisherA.publishBatch(50),
        publisherB.publishBatch(50),
      ]);
      if (left + right === 0) break;
    }

    const pending = await orm.em.fork().count(OutboxMessageRecord, {
      publishedAt: null,
    });
    expect(pending).toBe(0);
    const storedWallet = await orm.em.fork().findOneOrFail(WalletRecord, {
      id: wallet.walletId,
    });
    expect(storedWallet.balance).toBe('10.00');
    const event = await sqs.send(
      new ReceiveMessageCommand({
        QueueUrl: eventsQueueUrl,
        MaxNumberOfMessages: 1,
        WaitTimeSeconds: 1,
      }),
    );
    expect(event.Messages?.length).toBe(1);
  });

  test('resolve um reembolso fora de ordem e expira uma referência ausente', async () => {
    const wallet = await openWallet('100.00');
    const referenceExternalId = randomUUID();
    const roundId = randomUUID();
    const pendingExternalId = randomUUID();
    const pending = await processWager.execute({
      providerId: 'provider-pending',
      externalTransactionId: pendingExternalId,
      idempotencyKey: randomUUID(),
      walletId: wallet.walletId,
      playerId: wallet.playerId,
      roundId,
      gameId: 'game-1',
      kind: WagerTransactionKind.Refund,
      money: { amount: '25.00', currency: 'BRL' },
      referenceExternalTransactionId: referenceExternalId,
    });
    expect(pending.status).toBe(WagerTransactionStatus.PendingReference);

    await processWager.execute({
      providerId: 'provider-pending',
      externalTransactionId: referenceExternalId,
      idempotencyKey: randomUUID(),
      walletId: wallet.walletId,
      playerId: wallet.playerId,
      roundId,
      gameId: 'game-1',
      kind: WagerTransactionKind.Bet,
      money: { amount: '25.00', currency: 'BRL' },
    });
    expect(await pendingWorker.runOnce()).toBeGreaterThan(0);

    const resolved = await orm.em.fork().findOneOrFail(WagerTransactionRecord, {
      id: pending.transactionId,
    });
    expect(resolved.status).toBe(WagerTransactionStatus.Processed);
    expect(resolved.referenceTransactionId).not.toBeNull();
    const balancedWallet = await orm.em.fork().findOneOrFail(WalletRecord, {
      id: wallet.walletId,
    });
    expect(balancedWallet.balance).toBe('100.00');

    const expiringExternalId = randomUUID();
    const expiring = await processWager.execute({
      providerId: 'provider-pending',
      externalTransactionId: expiringExternalId,
      idempotencyKey: randomUUID(),
      walletId: wallet.walletId,
      playerId: wallet.playerId,
      roundId: randomUUID(),
      gameId: 'game-1',
      kind: WagerTransactionKind.Rollback,
      money: { amount: '5.00', currency: 'BRL' },
      referenceExternalTransactionId: randomUUID(),
    });
    await orm.em.fork().getConnection().execute(
      `update "wager_transactions"
       set "pending_reference_attempts" = 7, "next_reference_attempt_at" = now()
       where "id" = ?`,
      [expiring.transactionId],
    );
    await pendingWorker.runOnce();
    const expired = await orm.em.fork().findOneOrFail(WagerTransactionRecord, {
      id: expiring.transactionId,
    });
    expect(expired.status).toBe(WagerTransactionStatus.Rejected);
    expect(expired.failureCode).toBe(
      WagerTransactionFailureCode.ReferenceNotFound,
    );
  });

  test('mensagens inválidas chegam à DLQ configurada após esgotar as tentativas', async () => {
    await sqs.send(
      new SetQueueAttributesCommand({
        QueueUrl: queueUrl,
        Attributes: { VisibilityTimeout: '0' },
      }),
    );
    const messageId = randomUUID();
    await sqs.send(
      new SendMessageCommand({
        QueueUrl: queueUrl,
        MessageBody: '{invalid-json',
        MessageGroupId: 'invalid',
        MessageDeduplicationId: messageId,
      }),
    );
    try {
      for (let attempt = 0; attempt < 7; attempt += 1) {
        await consumer.pollOnce(0);
      }
      const dlq = await sqs.send(
        new ReceiveMessageCommand({
          QueueUrl: dlqUrl,
          MaxNumberOfMessages: 10,
          WaitTimeSeconds: 1,
        }),
      );
      expect(dlq.Messages?.some((message) => message.Body === '{invalid-json')).toBe(
        true,
      );
    } finally {
      await sqs.send(
        new SetQueueAttributesCommand({
          QueueUrl: queueUrl,
          Attributes: { VisibilityTimeout: '30' },
        }),
      );
    }
  }, 10_000);

  async function openWallet(initialBalance: string): Promise<{
    walletId: string;
    playerId: string;
  }> {
    const playerId = randomUUID();
    const result = await createWallet.execute({
      playerId,
      initialBalance: { amount: initialBalance, currency: 'BRL' },
    });
    return { walletId: result.id, playerId };
  }

  async function createFifoQueue(
    name: string,
    extraAttributes: Readonly<Record<string, string>> = {},
  ): Promise<string> {
    const result = await sqs.send(
      new CreateQueueCommand({
        QueueName: name,
        Attributes: {
          FifoQueue: 'true',
          ContentBasedDeduplication: 'true',
          ...extraAttributes,
        },
      }),
    );
    if (result.QueueUrl === undefined) throw new Error(`Fila ${name} sem URL`);
    return result.QueueUrl;
  }
});

function wagerMessage(
  wallet: { walletId: string; playerId: string },
  options: { readonly messageId: string; readonly amount?: string },
): string {
  return JSON.stringify({
    messageId: options.messageId,
    type: 'WagerTransactionRequested',
    occurredAt: new Date().toISOString(),
    data: {
      providerId: 'provider-sqs',
      externalTransactionId: options.messageId,
      idempotencyKey: options.messageId,
      playerId: wallet.playerId,
      walletId: wallet.walletId,
      roundId: randomUUID(),
      gameId: 'game-1',
      kind: WagerTransactionKind.Bet,
      money: { amount: options.amount ?? '25.00', currency: 'BRL' },
    },
  });
}
