import {
  Controller,
  Get,
  ServiceUnavailableException,
} from '@nestjs/common';

import { PostgresHealthIndicator } from '../../../infrastructure/health/postgres-health.indicator';
import { SqsHealthIndicator } from '../../../infrastructure/health/sqs-health.indicator';

interface HealthResponse {
  readonly status: 'ok';
  readonly timestamp: string;
}

@Controller('health')
export class HealthController {
  constructor(
    private readonly postgres: PostgresHealthIndicator,
    private readonly sqs: SqsHealthIndicator,
  ) {}

  @Get('live')
  live(): HealthResponse {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
    };
  }

  @Get('ready')
  async ready(): Promise<HealthResponse> {
    try {
      await Promise.all([this.postgres.check(), this.sqs.check()]);

      return {
        status: 'ok',
        timestamp: new Date().toISOString(),
      };
    } catch {
      throw new ServiceUnavailableException({
        status: 'error',
        message: 'Uma dependência obrigatória está indisponível',
      });
    }
  }
}
