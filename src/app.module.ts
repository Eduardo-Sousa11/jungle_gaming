import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MikroOrmModule } from '@mikro-orm/nestjs';

import mikroOrmConfig from './infrastructure/persistence/mikro-orm.config';
import { HealthModule } from './presentation/http/health/health.module';
import { WalletModule } from './presentation/http/wallet/wallet.module';
import { WageringModule } from './presentation/http/wagering/wagering.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    MikroOrmModule.forRoot(mikroOrmConfig),
    HealthModule,
    WalletModule,
    WageringModule,
  ],
})
export class AppModule {}
