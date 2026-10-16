import { IsString, Matches } from 'class-validator';

export class AiWalletTopupDto {
  @IsString()
  @Matches(/^[a-zA-Z0-9_-]{1,100}$/)
  offerId: string;

  @IsString()
  @Matches(/^[a-zA-Z0-9_-]{1,100}$/)
  operationKey: string;
}
