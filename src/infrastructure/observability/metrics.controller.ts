import { Controller, Get, Header } from '@nestjs/common';

import { MetricsRegistry } from './metrics.registry';

@Controller()
export class MetricsController {
  constructor(private readonly metrics: MetricsRegistry) {}

  @Get('metrics')
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  getMetrics(): string {
    return this.metrics.render();
  }
}
