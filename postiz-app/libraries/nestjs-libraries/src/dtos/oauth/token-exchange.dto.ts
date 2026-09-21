import { IsDefined, IsString, Matches } from 'class-validator';

export class TokenExchangeDto {
  @IsString()
  @IsDefined()
  grant_type: string;

  @IsString()
  @IsDefined()
  code: string;

  @IsString()
  @IsDefined()
  client_id: string;

  @IsString()
  @IsDefined()
  client_secret: string;
  @IsString()
  @IsDefined()
  redirect_uri: string;

  @IsString()
  @IsDefined()
  resource: string;

  @Matches(/^[A-Za-z0-9._~-]{43,128}$/)
  code_verifier: string;
}
