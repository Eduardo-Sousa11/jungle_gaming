import { Type } from 'class-transformer';
import { IsUUID, ValidateNested } from 'class-validator';

import { MoneyDto } from '../shared/money.dto';

export class CreateWalletDto {
  @IsUUID('all')
  declare playerId: string;

  @Type(() => MoneyDto)
  @ValidateNested()
  declare initialBalance: MoneyDto;
}
