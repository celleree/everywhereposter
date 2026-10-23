import { OAuthAuthorization, OAuthRefreshToken } from '@prisma/client';
import { Injectable } from '@nestjs/common';
import { PrismaRepository, PrismaTransaction } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';

@Injectable()
export class OAuthRepository {
  constructor(
    private _oauthApp: PrismaRepository<'oAuthApp'>,
    private _oauthAuth: PrismaRepository<'oAuthAuthorization'>,
    private _transaction: PrismaTransaction
  ) {}

  getAppByOrgId(orgId: string) {
    return this._oauthApp.model.oAuthApp.findFirst({
      where: {
        organizationId: orgId,
        deletedAt: null,
      },
      include: {
        picture: true,
      },
    });
  }

  getAppByClientId(clientId: string) {
    return this._oauthApp.model.oAuthApp.findFirst({
      where: {
        clientId,
        deletedAt: null,
      },
      include: {
        picture: true,
      },
    });
  }

  createApp(
    orgId: string,
    data: {
      name: string;
      description?: string;
      pictureId?: string;
      redirectUrl: string;
      clientId: string;
      clientSecret: string;
    }
  ) {
    return this._oauthApp.model.oAuthApp.create({
      data: {
        organizationId: orgId,
        name: data.name,
        description: data.description,
        pictureId: data.pictureId,
        redirectUrl: data.redirectUrl,
        clientId: data.clientId,
        clientSecret: data.clientSecret,
      },
      include: {
        picture: true,
      },
    });
  }

  async updateApp(
    orgId: string,
    data: {
      name?: string;
      description?: string;
      pictureId?: string;
      redirectUrl?: string;
    }
  ) {
    const app = await this._oauthApp.model.oAuthApp.findFirst({
      where: {
        organizationId: orgId,
        deletedAt: null,
      },
    });
    if (!app) {
      return null;
    }
    return this._oauthApp.model.oAuthApp.update({
      where: { id: app.id },
      data,
      include: {
        picture: true,
      },
    });
  }

  async deleteApp(orgId: string) {
    const app = await this._oauthApp.model.oAuthApp.findFirst({
      where: {
        organizationId: orgId,
        deletedAt: null,
      },
    });
    if (!app) {
      return null;
    }
    return this._oauthApp.model.oAuthApp.update({
      where: { id: app.id },
      data: {
        deletedAt: new Date(),
      },
    });
  }

  async updateClientSecret(orgId: string, newSecret: string) {
    const app = await this._oauthApp.model.oAuthApp.findFirst({
      where: {
        organizationId: orgId,
        deletedAt: null,
      },
    });
    if (!app) {
      return null;
    }
    return this._oauthApp.model.oAuthApp.update({
      where: { id: app.id },
      data: {
        clientSecret: newSecret,
      },
    });
  }

  createAuthorization(data: {
    oauthAppId: string;
    userId: string;
    organizationId: string;
    authorizationCode: string;
    codeExpiresAt: Date;
    scope: string;
    resource: string;
    redirectUri: string;
    codeChallenge: string;
  }) {
    return this._oauthAuth.model.oAuthAuthorization.upsert({
      where: {
        oauthAppId_userId_organizationId: {
          oauthAppId: data.oauthAppId,
          userId: data.userId,
          organizationId: data.organizationId,
        },
      },
      create: data,
      update: {
        ...data,
        tokenExpiresAt: null,
        accessToken: null,
        refreshFamilyId: null,
        revokedAt: null,
      },
    });
  }

  findByCode(encryptedCode: string) {
    return this._oauthAuth.model.oAuthAuthorization.findFirst({
      where: {
        authorizationCode: encryptedCode,
        revokedAt: null,
      },
    });
  }

  exchangeCodeForToken(
    auth: OAuthAuthorization,
    encryptedCode: string,
    encryptedToken: string,
    tokenExpiresAt: Date,
    refresh: { tokenHash: string; familyId: string; expiresAt: Date },
    clientSecret: string
  ) {
    return this._transaction.model.$transaction(async (tx) => {
      // The code is consumed and the refresh family created in the same transaction.
      const redeemed = await tx.oAuthAuthorization.updateMany({
        where: {
          id: auth.id,
          authorizationCode: encryptedCode,
          oauthAppId: auth.oauthAppId, userId: auth.userId, organizationId: auth.organizationId,
          scope: auth.scope, resource: auth.resource,
          revokedAt: null,
          codeExpiresAt: { gt: new Date() },
          oauthApp: { deletedAt: null, clientSecret },
          user: {
            activated: true,
            organizations: {
              some: { organizationId: auth.organizationId, disabled: false },
            },
          },
        },
        data: {
          accessToken: encryptedToken,
          refreshFamilyId: refresh.familyId,
          tokenExpiresAt,
          authorizationCode: null,
          codeExpiresAt: null,
        },
      });
      if (redeemed.count === 1) {
        await tx.oAuthRefreshToken.create({ data: { ...refresh, authorizationId: auth.id } });
      }
      return redeemed;
    });
  }

  findByRefreshToken(tokenHash: string) {
    return this._transaction.model.$transaction((tx) =>
      tx.oAuthRefreshToken.findUnique({ where: { tokenHash }, include: { authorization: true } })
    );
  }

  rotateRefreshToken(
    refresh: OAuthRefreshToken & { authorization: OAuthAuthorization },
    next: { tokenHash: string; accessToken: string; tokenExpiresAt: Date; scope: string },
    clientSecret: string
  ) {
    return this._transaction.model.$transaction(async (tx) => {
      const auth = refresh.authorization;
      // Serialize with rotation, revocation and new consent on this grant.
      await tx.$queryRaw`SELECT "id" FROM "OAuthAuthorization" WHERE "id" = ${auth.id} FOR UPDATE`;
      const active = await tx.oAuthAuthorization.findFirst({ where: {
        id: auth.id, oauthAppId: auth.oauthAppId, userId: auth.userId,
        organizationId: auth.organizationId, refreshFamilyId: refresh.familyId,
        scope: auth.scope, resource: auth.resource, revokedAt: null,
        oauthApp: { deletedAt: null, clientSecret },
        user: { activated: true, organizations: {
          some: { organizationId: auth.organizationId, disabled: false },
        } },
      } });
      if (!active || refresh.expiresAt <= new Date()) return false;
      if (refresh.usedAt) {
        // A previously consumed credential is replay: revoke only its current
        // family, never a later consent. Commit this before returning invalid_grant.
        await tx.oAuthAuthorization.update({ where: { id: auth.id }, data: { revokedAt: new Date() } });
        return false;
      }
      const consumed = await tx.oAuthRefreshToken.updateMany({
        where: { tokenHash: refresh.tokenHash, usedAt: null, expiresAt: { gt: new Date() } },
        data: { usedAt: new Date() },
      });
      // Both callers observed an unused token: only one rotates. A losing
      // in-flight request cannot revoke the winner or mint another descendant.
      if (consumed.count !== 1) return false;
      await tx.oAuthAuthorization.update({ where: { id: auth.id }, data: {
        accessToken: next.accessToken, tokenExpiresAt: next.tokenExpiresAt, scope: next.scope,
      } });
      await tx.oAuthRefreshToken.create({ data: {
        tokenHash: next.tokenHash, authorizationId: auth.id, familyId: refresh.familyId,
        expiresAt: refresh.expiresAt,
      } });
      return true;
    });
  }

  findByAccessToken(encryptedToken: string) {
    return this._oauthAuth.model.oAuthAuthorization.findFirst({
      where: {
        accessToken: encryptedToken,
        revokedAt: null,
      },
      include: {
        oauthApp: { select: { deletedAt: true } },
        organization: {
          include: {
            subscription: {
              select: {
                subscriptionTier: true,
                totalChannels: true,
                isLifetime: true,
              },
            },
          },
        },
        user: {
          select: {
            id: true,
            activated: true,
            organizations: { select: { organizationId: true, disabled: true } },
          },
        },
      },
    });
  }

  getApprovedApps(userId: string) {
    return this._oauthAuth.model.oAuthAuthorization.findMany({
      where: {
        userId,
        revokedAt: null,
        accessToken: { not: null },
      },
      select: {
        id: true, createdAt: true,
        oauthApp: { select: {
          name: true, description: true, picture: { select: { path: true } },
        } },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  revokeAuthorization(userId: string, authId: string) {
    return this._oauthAuth.model.oAuthAuthorization.update({
      where: {
        id: authId,
        userId,
      },
      data: {
        revokedAt: new Date(),
      },
    });
  }

  revokeToken(oauthAppId: string, tokenHash: string, accessToken: string) {
    return this._transaction.model.$transaction(async (tx) => {
      const refresh = await tx.oAuthRefreshToken.findUnique({ where: { tokenHash } });
      return tx.oAuthAuthorization.updateMany({ where: {
        oauthAppId, revokedAt: null,
        OR: [{ accessToken }, ...(refresh ? [{ id: refresh.authorizationId, refreshFamilyId: refresh.familyId }] : [])],
      }, data: { revokedAt: new Date() } });
    });
  }

  revokeAllForApp(oauthAppId: string) {
    return this._oauthAuth.model.oAuthAuthorization.updateMany({
      where: {
        oauthAppId,
        revokedAt: null,
      },
      data: {
        revokedAt: new Date(),
      },
    });
  }
}
