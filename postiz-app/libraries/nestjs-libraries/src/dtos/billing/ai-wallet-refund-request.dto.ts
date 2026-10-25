import { IsString, Matches } from 'class-validator';
export class AiWalletRefundRequestDto {
  @IsString()
  @Matches(/^[a-zA-Z0-9_-]{16,100}$/)
  operationKey: string;
}
