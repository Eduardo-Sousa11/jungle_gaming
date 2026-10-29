import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Query,
} from '@nestjs/common';

import {
  CreateWalletUseCase,
  type CreateWalletOutput,
} from '../../../application/wallet/create-wallet/create-wallet.use-case';
import { InvalidMoneyError } from '../../../domain/shared/money/money.errors';
import { GetWalletUseCase } from '../../../application/wallet/get-wallet/get-wallet.use-case';
import { WalletNotFoundError } from '../../../application/wallet/get-wallet/get-wallet.errors';
import type { WalletView } from '../../../application/wallet/get-wallet/wallet-query.repository';
import {
  InvalidLedgerCursorError,
  InvalidLedgerPageLimitError,
} from '../../../application/wallet/get-wallet-ledger/get-wallet-ledger.errors';
import {
  GetWalletLedgerUseCase,
  type GetWalletLedgerOutput,
} from '../../../application/wallet/get-wallet-ledger/get-wallet-ledger.use-case';
import {
  ReconcileWalletUseCase,
  type ReconcileWalletOutput,
} from '../../../application/wallet/reconcile-wallet/reconcile-wallet.use-case';
import {
  InvalidWalletError,
  WalletAlreadyExistsError,
} from '../../../domain/wallet/wallet.errors';
import { CreateWalletDto } from './create-wallet.dto';
import { GetWalletLedgerQueryDto } from './get-wallet-ledger-query.dto';
import { createUuidValidationPipe } from '../shared/uuid-validation.pipe';

@Controller('wallets')
export class WalletController {
  constructor(
    private readonly createWallet: CreateWalletUseCase,
    private readonly getWallet: GetWalletUseCase,
    private readonly getWalletLedger: GetWalletLedgerUseCase,
    private readonly reconcileWallet: ReconcileWalletUseCase,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() body: CreateWalletDto): Promise<CreateWalletOutput> {
    try {
      return await this.createWallet.execute({
        playerId: body.playerId,
        initialBalance: {
          amount: body.initialBalance.amount,
          currency: body.initialBalance.currency,
        },
      });
    } catch (error) {
      if (error instanceof WalletAlreadyExistsError) {
        throw new ConflictException({
          code: 'WALLET_ALREADY_EXISTS',
          message: 'Já existe uma carteira para este jogador e esta moeda',
        });
      }

      if (error instanceof InvalidMoneyError || error instanceof InvalidWalletError) {
        throw new BadRequestException({
          code: 'INVALID_WALLET_REQUEST',
          message: error.message,
        });
      }

      throw error;
    }
  }

  @Get(':walletId/ledger')
  async findLedger(
    @Param('walletId', createUuidValidationPipe()) walletId: string,
    @Query() query: GetWalletLedgerQueryDto,
  ): Promise<GetWalletLedgerOutput> {
    try {
      return await this.getWalletLedger.execute({
        walletId,
        ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
        ...(query.limit === undefined ? {} : { limit: query.limit }),
      });
    } catch (error) {
      if (error instanceof WalletNotFoundError) {
        throw this.walletNotFound(error);
      }
      if (error instanceof InvalidLedgerCursorError) {
        throw new BadRequestException({
          code: 'INVALID_LEDGER_CURSOR',
          message: error.message,
        });
      }
      if (error instanceof InvalidLedgerPageLimitError) {
        throw new BadRequestException({
          code: 'INVALID_LEDGER_LIMIT',
          message: error.message,
        });
      }
      throw error;
    }
  }

  @Post(':walletId/reconciliation')
  @HttpCode(HttpStatus.OK)
  async reconcile(
    @Param('walletId', createUuidValidationPipe()) walletId: string,
  ): Promise<ReconcileWalletOutput> {
    try {
      return await this.reconcileWallet.execute(walletId);
    } catch (error) {
      if (error instanceof WalletNotFoundError) {
        throw this.walletNotFound(error);
      }
      throw error;
    }
  }

  @Get(':walletId')
  async findById(
    @Param('walletId', createUuidValidationPipe()) walletId: string,
  ): Promise<WalletView> {
    try {
      return await this.getWallet.execute(walletId);
    } catch (error) {
      if (error instanceof WalletNotFoundError) {
        throw this.walletNotFound(error);
      }
      throw error;
    }
  }

  private walletNotFound(error: WalletNotFoundError): NotFoundException {
    return new NotFoundException({
      code: 'WALLET_NOT_FOUND',
      message: error.message,
    });
  }
}
