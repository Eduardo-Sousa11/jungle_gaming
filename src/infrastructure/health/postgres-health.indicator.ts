import { EntityManager } from '@mikro-orm/postgresql';
import { Injectable } from '@nestjs/common';

@Injectable()
export class PostgresHealthIndicator {
  constructor(private readonly entityManager: EntityManager) {}

  async check(): Promise<void> {
    await this.entityManager.getConnection().execute('select 1');
  }
}
