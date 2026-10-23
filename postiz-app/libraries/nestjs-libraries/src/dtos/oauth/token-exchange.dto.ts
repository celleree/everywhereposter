import { IsDefined, IsString, Matches, MaxLength, ValidateIf } from 'class-validator';

export class TokenExchangeDto {
  @IsString()
  @IsDefined()
  grant_type: string;

  @ValidateIf((o) => o.grant_type === 'authorization_code')
  @IsString()
  @IsDefined()
  code: string;

  @IsString()
  @IsDefined()
  client_id: string;

  @IsString()
  @IsDefined()
  client_secret: string;
  @ValidateIf((o) => o.grant_type === 'authorization_code')
  @IsString()
  @IsDefined()
  redirect_uri: string;

  @ValidateIf((o) => o.grant_type === 'authorization_code' || o.resource !== undefined)
  @IsString()
  @IsDefined()
  resource: string;

  @ValidateIf((o) => o.grant_type === 'authorization_code')
  @Matches(/^[A-Za-z0-9._~-]{43,128}$/)
  code_verifier: string;

  @ValidateIf((o) => o.grant_type === 'refresh_token')
  @Matches(/^por_[A-Za-z0-9_-]{43}$/)
  refresh_token?: string;

  @ValidateIf((o) => o.scope !== undefined)
  @IsString()
  @MaxLength(500)
  scope?: string;
}
