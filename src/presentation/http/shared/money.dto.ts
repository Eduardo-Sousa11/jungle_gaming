import { IsString, Matches } from 'class-validator';

export class MoneyDto {
  @IsString()
  @Matches(/^(?:0|[1-9]\d*)\.\d{2}$/)
  declare amount: string;

  @IsString()
  @Matches(/^[A-Z]{3}$/)
  declare currency: string;
}
