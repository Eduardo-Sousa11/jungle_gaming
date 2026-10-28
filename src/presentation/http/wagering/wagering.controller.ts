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
  ParseUUIDPipe,
  Post,
  Res,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';

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

interface MutableHttpResponse {
  status(statusCode: number): unknown;
}

@Controller('wagering')
export class WageringController {
  constructor(
    private readonly processWagerTransaction: ProcessWagerTransactionUseCase,
    private readonly getById: GetWagerTransactionByIdUseCase,
  ) {}

  @Post('transactions')
  @HttpCode(HttpStatus.OK)
  async process(
    @Body() body: ProcessWagerTransactionDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Res({ passthrough: true }) response: MutableHttpResponse,
  ): Promise<ProcessWagerTransactionOutput> {
    if (idempotencyKey === undefined || idempotencyKey.trim().length === 0) {
      throw new BadRequestException({
        code: 'IDEMPOTENCY_KEY_REQUIRED',
        message: 'The Idempotency-Key header is required',
      });
    }

    if (idempotencyKey.length > 255) {
      throw new BadRequestException({
        code: 'INVALID_IDEMPOTENCY_KEY',
        message: 'The Idempotency-Key header must have at most 255 characters',
      });
    }

    try {
      const output = await this.processWagerTransaction.execute({
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
      });
      response.status(this.httpStatusFor(output.status));
      return output;
    } catch (error) {
      this.rethrowAsHttpException(error);
    }
  }

  @Get('transactions/:transactionId')
  async findById(
    @Param('transactionId', new ParseUUIDPipe({ version: 'all' }))
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
        message: 'Provider and external transaction identifiers are invalid',
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
