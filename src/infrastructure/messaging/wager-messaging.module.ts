import { MikroOrmModule } from '@mikro-orm/nestjs';
import { Module } from '@nestjs/common';

import { CLOCK } from '../../application/shared/clock.port';
import { InboxMessageRecord } from '../persistence/entities/inbox-message.record';
import { OutboxMessageRecord } from '../persistence/entities/outbox-message.record';
import { WalletLedgerEntryRecord } from '../persistence/entities/wallet-ledger-entry.record';
import { WalletRecord } from '../persistence/entities/wallet.record';
import { WagerTransactionRecord } from '../persistence/entities/wager-transaction.record';
import { SystemClock } from '../shared/system-clock';
import { WageringModule } from '../../presentation/http/wagering/wagering.module';
import { SqsModule } from './sqs.module';
import { WagerSqsConsumer } from './wager-sqs.consumer';
import { WagerSqsMessageHandler } from './wager-sqs-message.handler';
import { OUTBOX_REPOSITORY } from '../../application/messaging/outbox/outbox.repository';
import { MikroOrmOutboxRepository } from '../persistence/repositories/mikro-orm-outbox.repository';
import { OutboxPublisher } from './outbox.publisher';
import {
  PENDING_REFERENCE_REPOSITORY,
  type PendingReferenceRepository,
} from '../../application/wagering/resolve-pending-references/pending-reference.repository';
import { ResolvePendingReferencesUseCase } from '../../application/wagering/resolve-pending-references/resolve-pending-references.use-case';
import { MikroOrmPendingReferenceRepository } from '../persistence/repositories/mikro-orm-pending-reference.repository';
import { ID_GENERATOR, type IdGenerator } from '../../application/shared/id-generator.port';
import type { Clock } from '../../application/shared/clock.port';
import { UuidGenerator } from '../shared/uuid-generator';
import { WagerOperationProcessor } from '../../domain/wagering/wager-operation-processor';
import { PendingReferenceWorker } from './pending-reference.worker';

@Module({
  imports: [
    SqsModule,
    WageringModule,
    MikroOrmModule.forFeature([
      WalletRecord,
      WagerTransactionRecord,
      WalletLedgerEntryRecord,
      InboxMessageRecord,
      OutboxMessageRecord,
    ]),
  ],
  providers: [
    WagerSqsMessageHandler,
    WagerSqsConsumer,
    { provide: CLOCK, useClass: SystemClock },
    MikroOrmOutboxRepository,
    { provide: OUTBOX_REPOSITORY, useExisting: MikroOrmOutboxRepository },
    OutboxPublisher,
    MikroOrmPendingReferenceRepository,
    {
      provide: PENDING_REFERENCE_REPOSITORY,
      useExisting: MikroOrmPendingReferenceRepository,
    },
    { provide: ID_GENERATOR, useClass: UuidGenerator },
    WagerOperationProcessor,
    {
      inject: [
        PENDING_REFERENCE_REPOSITORY,
        ID_GENERATOR,
        CLOCK,
        WagerOperationProcessor,
      ],
      provide: ResolvePendingReferencesUseCase,
      useFactory: (
        repository: PendingReferenceRepository,
        idGenerator: IdGenerator,
        clock: Clock,
        processor: WagerOperationProcessor,
      ): ResolvePendingReferencesUseCase =>
        new ResolvePendingReferencesUseCase(
          repository,
          idGenerator,
          clock,
          processor,
        ),
    },
    PendingReferenceWorker,
  ],
  exports: [
    WagerSqsMessageHandler,
    WagerSqsConsumer,
    OutboxPublisher,
    PendingReferenceWorker,
  ],
})
export class WagerMessagingModule {}
