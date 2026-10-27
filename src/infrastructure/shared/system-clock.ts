import { Injectable } from '@nestjs/common';

import type { Clock } from '../../application/shared/clock.port';

@Injectable()
export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}
