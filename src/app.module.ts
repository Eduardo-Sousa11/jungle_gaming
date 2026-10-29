import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import { APP_FILTER } from '@nestjs/core';

import mikroOrmConfig from './infrastructure/persistence/mikro-orm.config';
import { HealthModule } from './presentation/http/health/health.module';
import { WalletModule } from './presentation/http/wallet/wallet.module';
import { WageringModule } from './presentation/http/wagering/wagering.module';
import { WagerMessagingModule } from './infrastructure/messaging/wager-messaging.module';
import { ObservabilityModule } from './infrastructure/observability/observability.module';
import { ApplicationExceptionFilter } from './presentation/http/shared/application-exception.filter';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    ObservabilityModule,
    MikroOrmModule.forRoot(mikroOrmConfig),
    HealthModule,
    WalletModule,
    WageringModule,
    WagerMessagingModule,
  ],
  providers: [
    {
      provide: APP_FILTER,
      useClass: ApplicationExceptionFilter,
    },
  ],
})
export class AppModule {}
