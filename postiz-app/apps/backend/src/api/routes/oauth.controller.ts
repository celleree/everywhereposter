import {
  Body,
  Controller,
  Get,
  Header,
  HttpException,
  HttpStatus,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { OAuthService } from '@gitroom/nestjs-libraries/database/prisma/oauth/oauth.service';
import { GetUserFromRequest } from '@gitroom/nestjs-libraries/user/user.from.request';
import { GetOrgFromRequest } from '@gitroom/nestjs-libraries/user/org.from.request';
import { User, Organization } from '@prisma/client';
import { AuthorizeOAuthQueryDto, ApproveOAuthDto } from '@gitroom/nestjs-libraries/dtos/oauth/authorize-oauth.dto';
import { TokenExchangeDto } from '@gitroom/nestjs-libraries/dtos/oauth/token-exchange.dto';

@ApiTags('OAuth')
@Controller('/oauth')
export class OAuthController {
  constructor(private _oauthService: OAuthService) {}

  @Get('/authorize')
  async authorize(@Query() query: AuthorizeOAuthQueryDto) {
    const app = await this._oauthService.validateAuthorizationRequest(
      query
    );

    return {
      app: {
        name: app.name,
        description: app.description,
        picture: app.picture,
        clientId: app.clientId,
        redirectUrl: app.redirectUrl,
      },
      state: query.state,
    };
  }

  @Post('/token')
  @Header('Cache-Control', 'no-store')
  @Header('Pragma', 'no-cache')
  async token(@Body() body: TokenExchangeDto) {
    if (body.grant_type !== 'authorization_code') {
      throw new HttpException(
        { error: 'unsupported_grant_type' },
        HttpStatus.BAD_REQUEST
      );
    }

    return this._oauthService.exchangeCodeForToken(
      body
    );
  }
}

@ApiTags('OAuth')
@Controller('/oauth')
export class OAuthAuthorizedController {
  constructor(private _oauthService: OAuthService) {}

  @Post('/authorize')
  async approveOrDeny(
    @Body() body: ApproveOAuthDto,
    @GetUserFromRequest() user: User,
    @GetOrgFromRequest() org: Organization
  ) {
    const app = await this._oauthService.validateAuthorizationRequest(
      body
    );

    if (body.action === 'deny') {
      const redirectUrl = new URL(app.redirectUrl);
      redirectUrl.searchParams.set('error', 'access_denied');
      if (body.state) {
        redirectUrl.searchParams.set('state', body.state);
      }
      return { redirect: redirectUrl.toString() };
    }

    const code = await this._oauthService.createAuthorizationCode(
      app.id,
      user.id,
      org.id,
      body
    );

    const redirectUrl = new URL(app.redirectUrl);
    redirectUrl.searchParams.set('code', code);
    if (body.state) {
      redirectUrl.searchParams.set('state', body.state);
    }
    return { redirect: redirectUrl.toString() };
  }
}
