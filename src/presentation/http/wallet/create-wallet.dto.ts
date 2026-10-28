import { Type } from 'class-transformer';
import {
  IsString,
  IsUUID,
  Matches,
  ValidateNested,
} from 'class-validator';

export class MoneyDto {
  @IsString()
  @Matches(/^(?:0|[1-9]\d*)\.\d{2}$/)
  declare amount: string;

  @IsString()
  @Matches(/^[A-Z]{3}$/)
  declare currency: string;
}

export class CreateWalletDto {
  @IsUUID('all')
  declare playerId: string;

  @Type(() => MoneyDto)
  @ValidateNested()
  declare initialBalance: MoneyDto;
}
