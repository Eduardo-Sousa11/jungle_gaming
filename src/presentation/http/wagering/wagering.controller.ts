import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Res,
  ServiceUnavailableException,
  UnprocessableEntityException,
  Logger,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';

import {
  WagerExternalTransactionConflictError,
  WagerIdempotencyConflictError,
  WagerPersistenceRaceError,
  WagerWalletNotFoundError,
} from '../../../application/wagering/process-wager-transaction/process-wager-transaction.errors';
import {
  type ProcessWagerTransactionOutput,
  ProcessWagerTransactionUseCase,
} from '../../../application/wagering/process-wager-transaction/process-wager-transaction.use-case';
import {
  GetWagerTransactionByIdUseCase,
  GetWagerTransactionByProviderUseCase,
} from '../../../application/wagering/query-wager-transactions/get-wager-transaction.use-cases';
import { WagerTransactionNotFoundError } from '../../../application/wagering/query-wager-transactions/wager-transaction-query.errors';
import type { WagerTransactionView } from '../../../application/wagering/query-wager-transactions/wager-transaction-query.repository';
import { InvalidMoneyError } from '../../../domain/shared/money/money.errors';
import { InvalidWagerTransactionError } from '../../../domain/wagering/wager-transaction.errors';
import { WagerTransactionStatus } from '../../../domain/wagering/wager-transaction';
import { ProcessWagerTransactionDto } from './process-wager-transaction.dto';
import { MetricsRegistry } from '../../../infrastructure/observability/metrics.registry';
import { createUuidValidationPipe } from '../shared/uuid-validation.pipe';

interface MutableHttpResponse {
  status(statusCode: number): unknown;
  header(name: string, value: string): unknown;
}

@Controller('wagering')
export class WageringController {
  private readonly logger = new Logger(WageringController.name);

  constructor(
    private readonly processWagerTransaction: ProcessWagerTransactionUseCase,
    private readonly getById: GetWagerTransactionByIdUseCase,
    private readonly metrics: MetricsRegistry,
  ) {}

  @Post('transactions')
  @HttpCode(HttpStatus.OK)
  async process(
    @Body() body: ProcessWagerTransactionDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Headers('x-correlation-id') requestedCorrelationId: string | undefined,
    @Res({ passthrough: true }) response: MutableHttpResponse,
  ): Promise<ProcessWagerTransactionOutput> {
    if (idempotencyKey === undefined || idempotencyKey.trim().length === 0) {
      throw new BadRequestException({
        code: 'IDEMPOTENCY_KEY_REQUIRED',
        message: 'O cabeçalho Idempotency-Key é obrigatório',
      });
    }

    if (idempotencyKey.length > 255) {
      throw new BadRequestException({
        code: 'INVALID_IDEMPOTENCY_KEY',
        message: 'O cabeçalho Idempotency-Key deve possuir no máximo 255 caracteres',
      });
    }

    const correlationId =
      requestedCorrelationId === undefined ||
      requestedCorrelationId.trim().length === 0 ||
      requestedCorrelationId.length > 255
        ? randomUUID()
        : requestedCorrelationId;
    response.header('x-correlation-id', correlationId);
    const startedAt = performance.now();
    try {
      const output = await this.processWagerTransaction.execute(
        {
          providerId: body.providerId,
          externalTransactionId: body.externalTransactionId,
          idempotencyKey,
          walletId: body.walletId,
          playerId: body.playerId,
          roundId: body.roundId,
          gameId: body.gameId,
          kind: body.kind,
          money: {
            amount: body.money.amount,
            currency: body.money.currency,
          },
          referenceExternalTransactionId:
            body.referenceExternalTransactionId,
        },
        { correlationId },
      );
      this.metrics.increment('wager_transactions_total', {
        source: 'http',
        status: output.status,
      });
      if (output.idempotentReplay) {
        this.metrics.increment('wager_duplicates_total', { source: 'http' });
      }
      this.metrics.observe(
        'wager_processing_duration_seconds',
        (performance.now() - startedAt) / 1_000,
        { source: 'http' },
      );
      this.logger.log({
        event: 'aposta_http_processada',
        correlationId,
        transactionId: output.transactionId,
        walletId: body.walletId,
        providerId: body.providerId,
        status: output.status,
        idempotentReplay: output.idempotentReplay,
      });
      response.status(this.httpStatusFor(output.status));
      return output;
    } catch (error) {
      if (error instanceof WagerPersistenceRaceError) {
        this.metrics.increment('wager_lock_conflicts_total');
      }
      this.rethrowAsHttpException(error);
    }
  }

  @Get('transactions/:transactionId')
  async findById(
    @Param('transactionId', createUuidValidationPipe())
    transactionId: string,
  ): Promise<WagerTransactionView> {
    try {
      return await this.getById.execute(transactionId);
    } catch (error) {
      this.rethrowAsHttpException(error);
    }
  }

  private httpStatusFor(status: WagerTransactionStatus): number {
    switch (status) {
      case WagerTransactionStatus.Processed:
        return HttpStatus.OK;
      case WagerTransactionStatus.Pending:
      case WagerTransactionStatus.PendingReference:
        return HttpStatus.ACCEPTED;
      case WagerTransactionStatus.Rejected:
        return HttpStatus.UNPROCESSABLE_ENTITY;
      case WagerTransactionStatus.Failed:
        return HttpStatus.SERVICE_UNAVAILABLE;
    }
  }

  private rethrowAsHttpException(error: unknown): never {
    if (error instanceof WagerIdempotencyConflictError) {
      throw new ConflictException({
        code: 'IDEMPOTENCY_KEY_CONFLICT',
        message: error.message,
      });
    }

    if (error instanceof WagerExternalTransactionConflictError) {
      throw new ConflictException({
        code: 'EXTERNAL_TRANSACTION_CONFLICT',
        message: error.message,
      });
    }

    if (
      error instanceof WagerWalletNotFoundError ||
      error instanceof WagerTransactionNotFoundError
    ) {
      throw new NotFoundException({
        code:
          error instanceof WagerWalletNotFoundError
            ? 'WALLET_NOT_FOUND'
            : 'WAGER_TRANSACTION_NOT_FOUND',
        message: error.message,
      });
    }

    if (
      error instanceof InvalidMoneyError ||
      error instanceof InvalidWagerTransactionError
    ) {
      throw new BadRequestException({
        code: 'INVALID_WAGER_REQUEST',
        message: error.message,
      });
    }

    if (error instanceof WagerPersistenceRaceError) {
      throw new ServiceUnavailableException({
        code: 'CONCURRENT_PROCESSING_RETRY_EXHAUSTED',
        message: error.message,
      });
    }

    throw error;
  }
}

@Controller('providers')
export class ProviderWageringController {
  constructor(
    private readonly getByProvider: GetWagerTransactionByProviderUseCase,
  ) {}

  @Get(':providerId/wagering/transactions/:externalTransactionId')
  async findByProvider(
    @Param('providerId') providerId: string,
    @Param('externalTransactionId') externalTransactionId: string,
  ): Promise<WagerTransactionView> {
    if (
      providerId.trim().length === 0 ||
      providerId.length > 100 ||
      externalTransactionId.trim().length === 0 ||
      externalTransactionId.length > 255
    ) {
      throw new BadRequestException({
        code: 'INVALID_TRANSACTION_IDENTIFIER',
        message: 'Os identificadores do provedor e da transação externa são inválidos',
      });
    }

    try {
      return await this.getByProvider.execute(
        providerId,
        externalTransactionId,
      );
    } catch (error) {
      if (error instanceof WagerTransactionNotFoundError) {
        throw new NotFoundException({
          code: 'WAGER_TRANSACTION_NOT_FOUND',
          message: error.message,
        });
      }
      throw error;
    }
  }
}
