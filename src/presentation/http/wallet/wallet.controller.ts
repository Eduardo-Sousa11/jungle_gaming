import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
} from '@nestjs/common';

import {
  CreateWalletUseCase,
  type CreateWalletOutput,
} from '../../../application/wallet/create-wallet/create-wallet.use-case';
import { InvalidMoneyError } from '../../../domain/shared/money/money.errors';
import {
  InvalidWalletError,
  WalletAlreadyExistsError,
} from '../../../domain/wallet/wallet.errors';
import { CreateWalletDto } from './create-wallet.dto';

@Controller('wallets')
export class WalletController {
  constructor(private readonly createWallet: CreateWalletUseCase) {}

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
          message: 'A wallet already exists for this player and currency',
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
}
