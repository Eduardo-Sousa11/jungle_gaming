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
import { GetWalletLedgerUseCase } from '../../../application/wallet/get-wallet-ledger/get-wallet-ledger.use-case';
import {
  LEDGER_CURSOR_CODEC,
  type LedgerCursorCodec,
} from '../../../application/wallet/get-wallet-ledger/ledger-cursor.codec';
import {
  WALLET_LEDGER_QUERY_REPOSITORY,
  type WalletLedgerQueryRepository,
} from '../../../application/wallet/get-wallet-ledger/wallet-ledger-query.repository';
import { ReconcileWalletUseCase } from '../../../application/wallet/reconcile-wallet/reconcile-wallet.use-case';
import {
  WALLET_RECONCILIATION_MONITOR,
  type WalletReconciliationMonitor,
} from '../../../application/wallet/reconcile-wallet/wallet-reconciliation.monitor';
import {
  WALLET_RECONCILIATION_REPOSITORY,
  type WalletReconciliationRepository,
} from '../../../application/wallet/reconcile-wallet/wallet-reconciliation.repository';
import {
  WALLET_CREATION_REPOSITORY,
  type WalletCreationRepository,
} from '../../../application/wallet/create-wallet/wallet-creation.repository';
import { WalletLedgerEntryRecord } from '../../../infrastructure/persistence/entities/wallet-ledger-entry.record';
import { WalletRecord } from '../../../infrastructure/persistence/entities/wallet.record';
import { WagerTransactionRecord } from '../../../infrastructure/persistence/entities/wager-transaction.record';
import { MikroOrmWalletCreationRepository } from '../../../infrastructure/persistence/repositories/mikro-orm-wallet-creation.repository';
import { MikroOrmWalletQueryRepository } from '../../../infrastructure/persistence/repositories/mikro-orm-http-query.repositories';
import { MikroOrmWalletLedgerRepository } from '../../../infrastructure/persistence/repositories/mikro-orm-wallet-ledger.repository';
import { NestWalletReconciliationMonitor } from '../../../infrastructure/observability/wallet-reconciliation.monitor';
import { Base64UrlLedgerCursorCodec } from '../../../infrastructure/shared/base64url-ledger-cursor.codec';
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
    MikroOrmWalletLedgerRepository,
    {
      provide: WALLET_LEDGER_QUERY_REPOSITORY,
      useExisting: MikroOrmWalletLedgerRepository,
    },
    {
      provide: WALLET_RECONCILIATION_REPOSITORY,
      useExisting: MikroOrmWalletLedgerRepository,
    },
    Base64UrlLedgerCursorCodec,
    {
      provide: LEDGER_CURSOR_CODEC,
      useExisting: Base64UrlLedgerCursorCodec,
    },
    NestWalletReconciliationMonitor,
    {
      provide: WALLET_RECONCILIATION_MONITOR,
      useExisting: NestWalletReconciliationMonitor,
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
    {
      inject: [WALLET_LEDGER_QUERY_REPOSITORY, LEDGER_CURSOR_CODEC],
      provide: GetWalletLedgerUseCase,
      useFactory: (
        repository: WalletLedgerQueryRepository,
        cursorCodec: LedgerCursorCodec,
      ): GetWalletLedgerUseCase =>
        new GetWalletLedgerUseCase(repository, cursorCodec),
    },
    {
      inject: [
        WALLET_RECONCILIATION_REPOSITORY,
        WALLET_RECONCILIATION_MONITOR,
      ],
      provide: ReconcileWalletUseCase,
      useFactory: (
        repository: WalletReconciliationRepository,
        monitor: WalletReconciliationMonitor,
      ): ReconcileWalletUseCase =>
        new ReconcileWalletUseCase(repository, monitor),
    },
  ],
})
export class WalletModule {}
