import { Module } from '@nestjs/common';

import { PostgresHealthIndicator } from '../../../infrastructure/health/postgres-health.indicator';
import { SqsHealthIndicator } from '../../../infrastructure/health/sqs-health.indicator';
import { SqsModule } from '../../../infrastructure/messaging/sqs.module';
import { HealthController } from './health.controller';

@Module({
  controllers: [HealthController],
  imports: [SqsModule],
  providers: [PostgresHealthIndicator, SqsHealthIndicator],
})
export class HealthModule {}
