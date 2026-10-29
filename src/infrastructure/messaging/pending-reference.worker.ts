import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { ResolvePendingReferencesUseCase } from '../../application/wagering/resolve-pending-references/resolve-pending-references.use-case';

@Injectable()
export class PendingReferenceWorker
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(PendingReferenceWorker.name);
  private readonly enabled: boolean;
  private readonly pollInterval: number;
  private running = false;
  private loopPromise?: Promise<void>;

  constructor(
    private readonly useCase: ResolvePendingReferencesUseCase,
    config: ConfigService,
  ) {
    this.enabled = config.get('WORKERS_ENABLED', 'false') === 'true';
    const configuredInterval = Number.parseInt(
      config.get('PENDING_REFERENCE_POLL_INTERVAL_MS', '1000'),
      10,
    );
    this.pollInterval =
      Number.isSafeInteger(configuredInterval) && configuredInterval > 0
        ? configuredInterval
        : 1_000;
  }

  onApplicationBootstrap(): void {
    if (!this.enabled) return;
    this.running = true;
    this.loopPromise = this.loop();
  }

  async onApplicationShutdown(): Promise<void> {
    this.running = false;
    await this.loopPromise;
  }

  async runOnce(limit = 20): Promise<number> {
    return this.useCase.executeBatch(limit);
  }

  private async loop(): Promise<void> {
    while (this.running) {
      try {
        const count = await this.runOnce();
        if (count === 0) await delay(this.pollInterval);
      } catch (error) {
        this.logger.error({
          event: 'pending_reference_batch_failed',
          errorCode: error instanceof Error ? error.name : 'UNKNOWN_ERROR',
        });
        await delay(this.pollInterval);
      }
    }
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
