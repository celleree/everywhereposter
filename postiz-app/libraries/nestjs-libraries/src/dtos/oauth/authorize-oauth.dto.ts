import {
  IsDefined,
  IsIn,
  IsOptional,
  IsString,
  Matches,
} from 'class-validator';

export class AuthorizeOAuthQueryDto {
  @IsString()
  @IsDefined()
  client_id: string;

  @IsString()
  @IsDefined()
  @IsIn(['code'])
  response_type: string;

  @IsString()
  @IsDefined()
  redirect_uri: string;

  @IsIn(['accounts:read'])
  scope: string;

  @IsString()
  @IsDefined()
  resource: string;

  @Matches(/^[A-Za-z0-9_-]{43}$/)
  code_challenge: string;

  @IsIn(['S256'])
  code_challenge_method: string;

  @IsString()
  @IsOptional()
  state?: string;
}

export class ApproveOAuthDto extends AuthorizeOAuthQueryDto {
  @IsString()
  @IsDefined()
  @IsIn(['approve', 'deny'])
  action: 'approve' | 'deny';
}
