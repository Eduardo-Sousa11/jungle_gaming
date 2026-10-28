import { Type } from 'class-transformer';
import {
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

import { WagerTransactionKind } from '../../../domain/wagering/wager-transaction';
import { MoneyDto } from '../shared/money.dto';

const EXTERNAL_WAGER_KINDS = [
  WagerTransactionKind.Bet,
  WagerTransactionKind.Win,
  WagerTransactionKind.Loss,
  WagerTransactionKind.Refund,
  WagerTransactionKind.Rollback,
] as const;

export class ProcessWagerTransactionDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  declare providerId: string;

  @IsString()
  @MinLength(1)
  @MaxLength(255)
  declare externalTransactionId: string;

  @IsUUID('all')
  declare playerId: string;

  @IsUUID('all')
  declare walletId: string;

  @IsString()
  @MinLength(1)
  @MaxLength(255)
  declare roundId: string;

  @IsString()
  @MinLength(1)
  @MaxLength(255)
  declare gameId: string;

  @IsIn(EXTERNAL_WAGER_KINDS)
  declare kind: WagerTransactionKind;

  @Type(() => MoneyDto)
  @ValidateNested()
  declare money: MoneyDto;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  declare referenceExternalTransactionId?: string;
}
