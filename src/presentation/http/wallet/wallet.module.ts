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
import { CreateWalletUseCase } from '../../../application/wallet/create-wallet/create-wallet.use-case';
import { GetWalletUseCase } from '../../../application/wallet/get-wallet/get-wallet.use-case';
import {
  WALLET_QUERY_REPOSITORY,
  type WalletQueryRepository,
} from '../../../application/wallet/get-wallet/wallet-query.repository';
import {
  WALLET_CREATION_REPOSITORY,
  type WalletCreationRepository,
} from '../../../application/wallet/create-wallet/wallet-creation.repository';
import { WalletLedgerEntryRecord } from '../../../infrastructure/persistence/entities/wallet-ledger-entry.record';
import { WalletRecord } from '../../../infrastructure/persistence/entities/wallet.record';
import { WagerTransactionRecord } from '../../../infrastructure/persistence/entities/wager-transaction.record';
import { MikroOrmWalletCreationRepository } from '../../../infrastructure/persistence/repositories/mikro-orm-wallet-creation.repository';
import { MikroOrmWalletQueryRepository } from '../../../infrastructure/persistence/repositories/mikro-orm-http-query.repositories';
import { Sha256PayloadHasher } from '../../../infrastructure/shared/sha256-payload-hasher';
import { SystemClock } from '../../../infrastructure/shared/system-clock';
import { UuidGenerator } from '../../../infrastructure/shared/uuid-generator';
import { WalletController } from './wallet.controller';

@Module({
  controllers: [WalletController],
  imports: [
    MikroOrmModule.forFeature([
      WalletRecord,
      WagerTransactionRecord,
      WalletLedgerEntryRecord,
    ]),
  ],
  providers: [
    {
      provide: WALLET_CREATION_REPOSITORY,
      useClass: MikroOrmWalletCreationRepository,
    },
    {
      provide: WALLET_QUERY_REPOSITORY,
      useClass: MikroOrmWalletQueryRepository,
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
        WALLET_CREATION_REPOSITORY,
        ID_GENERATOR,
        CLOCK,
        PAYLOAD_HASHER,
      ],
      provide: CreateWalletUseCase,
      useFactory: (
        repository: WalletCreationRepository,
        idGenerator: IdGenerator,
        clock: Clock,
        payloadHasher: PayloadHasher,
      ): CreateWalletUseCase =>
        new CreateWalletUseCase(
          repository,
          idGenerator,
          clock,
          payloadHasher,
        ),
    },
    {
      inject: [WALLET_QUERY_REPOSITORY],
      provide: GetWalletUseCase,
      useFactory: (repository: WalletQueryRepository): GetWalletUseCase =>
        new GetWalletUseCase(repository),
    },
  ],
})
export class WalletModule {}
