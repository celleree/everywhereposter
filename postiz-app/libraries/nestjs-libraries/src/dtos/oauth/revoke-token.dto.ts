import { IsString, MaxLength } from 'class-validator';

export class RevokeTokenDto {
  @IsString()
  client_id: string;

  @IsString()
  client_secret: string;

  @IsString()
  @MaxLength(1024)
  token: string;
}
