import { MikroOrmModule } from '@mikro-orm/nestjs';
import { Module } from '@nestjs/common';

import { CLOCK, type Clock } from '../../../application/shared/clock.port';
import {
  ID_GENERATOR,
  type IdGenerator,
} from '../../../application/shared/id-generator.port';
import {
  PAYLOAD_HASHER,
  type PayloadHasher,
} from '../../../application/shared/payload-hasher.port';
import { ProcessWagerTransactionUseCase } from '../../../application/wagering/process-wager-transaction/process-wager-transaction.use-case';
import {
  WAGER_PROCESSING_REPOSITORY,
  type WagerProcessingRepository,
} from '../../../application/wagering/process-wager-transaction/wager-processing.repository';
import {
  GetWagerTransactionByIdUseCase,
  GetWagerTransactionByProviderUseCase,
} from '../../../application/wagering/query-wager-transactions/get-wager-transaction.use-cases';
import {
  WAGER_TRANSACTION_QUERY_REPOSITORY,
  type WagerTransactionQueryRepository,
} from '../../../application/wagering/query-wager-transactions/wager-transaction-query.repository';
import { WagerOperationProcessor } from '../../../domain/wagering/wager-operation-processor';
import { WalletLedgerEntryRecord } from '../../../infrastructure/persistence/entities/wallet-ledger-entry.record';
import { WalletRecord } from '../../../infrastructure/persistence/entities/wallet.record';
import { WagerTransactionRecord } from '../../../infrastructure/persistence/entities/wager-transaction.record';
import { MikroOrmWagerTransactionQueryRepository } from '../../../infrastructure/persistence/repositories/mikro-orm-http-query.repositories';
import { MikroOrmWagerProcessingRepository } from '../../../infrastructure/persistence/repositories/mikro-orm-wager-processing.repository';
import { Sha256PayloadHasher } from '../../../infrastructure/shared/sha256-payload-hasher';
import { SystemClock } from '../../../infrastructure/shared/system-clock';
import { UuidGenerator } from '../../../infrastructure/shared/uuid-generator';
import {
  ProviderWageringController,
  WageringController,
} from './wagering.controller';

@Module({
  controllers: [WageringController, ProviderWageringController],
  imports: [
    MikroOrmModule.forFeature([
      WalletRecord,
      WagerTransactionRecord,
      WalletLedgerEntryRecord,
    ]),
  ],
  providers: [
    WagerOperationProcessor,
    {
      provide: WAGER_PROCESSING_REPOSITORY,
      useClass: MikroOrmWagerProcessingRepository,
    },
    {
      provide: WAGER_TRANSACTION_QUERY_REPOSITORY,
      useClass: MikroOrmWagerTransactionQueryRepository,
    },
    {
      provide: ID_GENERATOR,
      useClass: UuidGenerator,
    },
    {
      provide: CLOCK,
      useClass: SystemClock,
    },
    {
      provide: PAYLOAD_HASHER,
      useClass: Sha256PayloadHasher,
    },
    {
      inject: [
        WAGER_PROCESSING_REPOSITORY,
        ID_GENERATOR,
        CLOCK,
        PAYLOAD_HASHER,
        WagerOperationProcessor,
      ],
      provide: ProcessWagerTransactionUseCase,
      useFactory: (
        repository: WagerProcessingRepository,
        idGenerator: IdGenerator,
        clock: Clock,
        payloadHasher: PayloadHasher,
        operationProcessor: WagerOperationProcessor,
      ): ProcessWagerTransactionUseCase =>
        new ProcessWagerTransactionUseCase(
          repository,
          idGenerator,
          clock,
          payloadHasher,
          operationProcessor,
        ),
    },
    {
      inject: [WAGER_TRANSACTION_QUERY_REPOSITORY],
      provide: GetWagerTransactionByIdUseCase,
      useFactory: (
        repository: WagerTransactionQueryRepository,
      ): GetWagerTransactionByIdUseCase =>
        new GetWagerTransactionByIdUseCase(repository),
    },
    {
      inject: [WAGER_TRANSACTION_QUERY_REPOSITORY],
      provide: GetWagerTransactionByProviderUseCase,
      useFactory: (
        repository: WagerTransactionQueryRepository,
      ): GetWagerTransactionByProviderUseCase =>
        new GetWagerTransactionByProviderUseCase(repository),
    },
  ],
})
export class WageringModule {}
