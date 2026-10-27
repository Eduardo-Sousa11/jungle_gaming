import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import type { IdGenerator } from '../../application/shared/id-generator.port';

@Injectable()
export class UuidGenerator implements IdGenerator {
  generate(): string {
    return randomUUID();
  }
}
