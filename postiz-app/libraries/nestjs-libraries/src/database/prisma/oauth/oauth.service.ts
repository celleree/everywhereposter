import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { OAuthRepository } from '@gitroom/nestjs-libraries/database/prisma/oauth/oauth.repository';
import { CreateOAuthAppDto } from '@gitroom/nestjs-libraries/dtos/oauth/create-oauth-app.dto';
import { UpdateOAuthAppDto } from '@gitroom/nestjs-libraries/dtos/oauth/update-oauth-app.dto';
import { createHash, randomBytes } from 'crypto';
import { AuthorizeOAuthQueryDto } from '@gitroom/nestjs-libraries/dtos/oauth/authorize-oauth.dto';
import { TokenExchangeDto } from '@gitroom/nestjs-libraries/dtos/oauth/token-exchange.dto';

import { AuthService } from '@gitroom/helpers/auth/auth.service';

export const ACCOUNTS_READ_SCOPE = 'accounts:read';
export const getMcpResource = () =>
  `${process.env.NEXT_PUBLIC_BACKEND_URL!.replace(/\/$/, '')}/mcp-oauth`;
const TOKEN_LIFETIME_SECONDS = 3600;

@Injectable()
export class OAuthService {
  constructor(private _oauthRepository: OAuthRepository) {}

  async getApp(orgId: string) {
    const app = await this._oauthRepository.getAppByOrgId(orgId);
    if (!app) return false;
    const { clientSecret, ...rest } = app;
    return rest;
  }

  async createApp(orgId: string, dto: CreateOAuthAppDto) {
    const existing = await this._oauthRepository.getAppByOrgId(orgId);
    if (existing) {
      throw new HttpException(
        'You can only have one OAuth application per organization',
        HttpStatus.BAD_REQUEST
      );
    }

    const clientId = 'pca_' + randomBytes(32).toString('base64url');
    const clientSecret = 'pcs_' + randomBytes(48).toString('base64url');
    const encryptedSecret = AuthService.fixedEncryption(clientSecret);

    const app = await this._oauthRepository.createApp(orgId, {
      name: dto.name,
      description: dto.description,
      pictureId: dto.pictureId,
      redirectUrl: dto.redirectUrl,
      clientId,
      clientSecret: encryptedSecret,
    });

    return { ...app, clientSecret };
  }

  async updateApp(orgId: string, dto: UpdateOAuthAppDto) {
    return this._oauthRepository.updateApp(orgId, {
      ...(dto.name && { name: dto.name }),
      ...(dto.description !== undefined && { description: dto.description }),
      ...(dto.pictureId !== undefined && { pictureId: dto.pictureId }),
      ...(dto.redirectUrl && { redirectUrl: dto.redirectUrl }),
    });
  }

  async deleteApp(orgId: string) {
    const app = await this._oauthRepository.getAppByOrgId(orgId);
    if (!app) {
      throw new HttpException('No OAuth app found', HttpStatus.NOT_FOUND);
    }
    await this._oauthRepository.revokeAllForApp(app.id);
    await this._oauthRepository.deleteApp(orgId);
    return { success: true };
  }

  async rotateSecret(orgId: string) {
    const app = await this._oauthRepository.getAppByOrgId(orgId);
    if (!app) {
      throw new HttpException('No OAuth app found', HttpStatus.NOT_FOUND);
    }

    const newSecret = 'pcs_' + randomBytes(48).toString('base64url');
    const encrypted = AuthService.fixedEncryption(newSecret);
    await this._oauthRepository.updateClientSecret(orgId, encrypted);
    return { clientSecret: newSecret };
  }

  async validateAuthorizationRequest(request: AuthorizeOAuthQueryDto) {
    const app = await this._oauthRepository.getAppByClientId(request.client_id);
    if (!app) {
      throw new HttpException('Invalid client_id', HttpStatus.BAD_REQUEST);
    }
    if (
      request.response_type !== 'code' ||
      request.redirect_uri !== app.redirectUrl ||
      request.scope !== ACCOUNTS_READ_SCOPE ||
      request.resource !== getMcpResource() ||
      request.code_challenge_method !== 'S256' ||
      !/^[A-Za-z0-9_-]{43}$/.test(request.code_challenge || '')
    ) {
      throw new HttpException(
        { error: 'invalid_request' },
        HttpStatus.BAD_REQUEST
      );
    }
    return app;
  }

  async createAuthorizationCode(
    oauthAppId: string,
    userId: string,
    organizationId: string,
    request: AuthorizeOAuthQueryDto
  ) {
    const code = randomBytes(32).toString('base64url');
    const encryptedCode = AuthService.fixedEncryption(code);
    const codeExpiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await this._oauthRepository.createAuthorization({
      oauthAppId,
      userId,
      organizationId,
      authorizationCode: encryptedCode,
      codeExpiresAt,
      scope: request.scope,
      resource: request.resource,
      redirectUri: request.redirect_uri,
      codeChallenge: request.code_challenge,
    });

    return code;
  }

  async exchangeCodeForToken(request: TokenExchangeDto) {
    const app = await this._oauthRepository.getAppByClientId(request.client_id);
    if (
      !app ||
      app.clientSecret !== AuthService.fixedEncryption(request.client_secret)
    ) {
      throw new HttpException(
        { error: 'invalid_client' },
        HttpStatus.UNAUTHORIZED
      );
    }

    const encryptedCode = AuthService.fixedEncryption(request.code);
    const auth = await this._oauthRepository.findByCode(encryptedCode);
    if (
      !auth ||
      auth.oauthAppId !== app.id ||
      auth.revokedAt ||
      !auth.codeExpiresAt ||
      auth.codeExpiresAt <= new Date() ||
      auth.scope !== ACCOUNTS_READ_SCOPE ||
      auth.resource !== getMcpResource() ||
      request.resource !== auth.resource ||
      request.redirect_uri !== auth.redirectUri ||
      !/^[A-Za-z0-9._~-]{43,128}$/.test(request.code_verifier || '') ||
      createHash('sha256').update(request.code_verifier).digest('base64url') !==
        auth.codeChallenge
    ) {
      throw new HttpException(
        { error: 'invalid_grant' },
        HttpStatus.BAD_REQUEST
      );
    }

    const token = 'pos_' + randomBytes(32).toString('base64url');
    const redeemed = await this._oauthRepository.exchangeCodeForToken(
      auth,
      encryptedCode,
      AuthService.fixedEncryption(token),
      new Date(Date.now() + TOKEN_LIFETIME_SECONDS * 1000)
    );
    if (redeemed.count !== 1) {
      throw new HttpException(
        { error: 'invalid_grant' },
        HttpStatus.BAD_REQUEST
      );
    }
    return {
      access_token: token,
      token_type: 'bearer',
      expires_in: TOKEN_LIFETIME_SECONDS,
      scope: auth.scope,
    };
  }

  async getOrgByOAuthToken(token: string, resource: string, scope: string) {
    if (
      !token.startsWith('pos_') ||
      resource !== getMcpResource() ||
      scope !== ACCOUNTS_READ_SCOPE
    )
      return null;
    const auth = await this._oauthRepository.findByAccessToken(
      AuthService.fixedEncryption(token)
    );
    if (
      !auth ||
      auth.revokedAt ||
      auth.oauthApp.deletedAt ||
      !auth.tokenExpiresAt ||
      auth.tokenExpiresAt <= new Date() ||
      auth.resource !== resource ||
      auth.scope !== scope ||
      !auth.user.activated ||
      !auth.user.organizations.some(
        (membership) =>
          membership.organizationId === auth.organizationId &&
          !membership.disabled
      )
    )
      return null;
    return auth;
  }

  async getApprovedApps(userId: string) {
    return this._oauthRepository.getApprovedApps(userId);
  }

  async revokeApp(userId: string, authId: string) {
    await this._oauthRepository.revokeAuthorization(userId, authId);
    return { success: true };
  }
}
