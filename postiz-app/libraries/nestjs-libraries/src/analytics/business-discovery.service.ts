import { HttpException, Injectable } from '@nestjs/common';
import { suppressTracing } from '@sentry/nestjs';
import { createHash, createHmac, timingSafeEqual } from 'crypto';
import { IntegrationRepository } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.repository';
import {
  BusinessDiscoveryQuery,
  BusinessDiscoveryResult,
} from '@gitroom/nestjs-libraries/dtos/analytics/business-discovery.dto';

const GRAPH = 'https://graph.facebook.com/v25.0/';
const SCOPES = [
  'instagram_basic',
  'instagram_manage_insights',
  'pages_read_engagement',
  'pages_show_list',
];
const cursorPattern = /^[A-Za-z0-9_=-]{1,1024}$/;
const id = (value: unknown): value is string =>
  typeof value === 'string' && /^\d+$/.test(value);
const text = (value: unknown) => (typeof value === 'string' ? value : null);
const count = (value: unknown) =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
const hash = (value: string) =>
  createHash('sha256').update(value).digest('hex');
function fail(code: string, message: string, status = 400): never {
  throw new HttpException({ code, message }, status);
}
function safeUrl(value: unknown, preview = false): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      /token|secret|authorization/i.test(url.search)
    )
      return null;
    if (preview && !/(^|\.)(cdninstagram\.com|fbcdn\.net)$/.test(url.hostname))
      return null;
    return url.href;
  } catch {
    return null;
  }
}

@Injectable()
export class BusinessDiscoveryService {
  constructor(private readonly integrations: IntegrationRepository) {}

  private async graph(
    path: string,
    token: string,
    params: Record<string, string>,
    discovery = false
  ) {
    const url = new URL(path, GRAPH);
    for (const [key, value] of Object.entries(params))
      url.searchParams.set(key, value);
    try {
      // Sentry's Node fetch instrumentation skips suppressed requests, including breadcrumbs.
      const response = await suppressTracing(() =>
        fetch(url, {
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(10000),
          redirect: 'error',
        })
      );
      const body = await response.json();
      if (!response.ok || body?.error) {
        const code = body?.error?.code;
        if (response.status === 429 || [4, 17, 32, 613, 80004].includes(code))
          fail(
            'RATE_LIMITED',
            'Meta rate limit reached. Wait before submitting another search.',
            429
          );
        if (code === 190)
          fail(
            'RECONNECT_REQUIRED',
            'Reconnect this Instagram channel using Facebook Login, then select its linked Page.',
            409
          );
        if ([10, 200].includes(code))
          fail(
            'MISSING_PERMISSIONS',
            'Meta denied permission. Reconnect with the required Instagram and Page permissions. A Page role granted through Business Manager may require an existing ads_read or ads_management grant; ask the app administrator to verify this requirement.',
            403
          );
        if (code === 100 && !discovery)
          fail(
            'RECONNECT_REQUIRED',
            'The current Facebook authorization could not verify this connection. Reconnect this Instagram channel and linked Page.',
            409
          );
        if (code === 100)
          fail(
            'TARGET_UNAVAILABLE',
            'The target or requested public data is unavailable. Check the username and professional-account eligibility.',
            404
          );
        fail(
          'UPSTREAM_ERROR',
          'Meta could not complete this search. Try again later.',
          502
        );
      }
      if (!body || typeof body !== 'object')
        fail('UPSTREAM_ERROR', 'Meta returned an incomplete response.', 502);
      return body;
    } catch (error) {
      if (error instanceof HttpException) throw error;
      // Fetch errors can embed request URLs and credentials. Never forward or log them.
      fail(
        'UPSTREAM_ERROR',
        'Meta could not complete this search. Try again later.',
        502
      );
    }
  }

  private sign(payload: string) {
    const secret = process.env.JWT_SECRET;
    if (!secret)
      fail('UNAVAILABLE', 'Business Discovery is not configured.', 503);
    return createHmac('sha256', secret)
      .update(`business-discovery:${payload}`)
      .digest('base64url');
  }

  async search(
    orgId: string,
    actorId: string,
    session: string,
    integrationId: string,
    query: BusinessDiscoveryQuery
  ): Promise<BusinessDiscoveryResult> {
    if (!orgId || !actorId || !session)
      fail('UNAUTHORIZED', 'Sign in to search.', 403);
    if (
      !query ||
      Object.keys(query).some((key) => !['username', 'cursor'].includes(key)) ||
      typeof query.username !== 'string' ||
      query.username.length > 64
    )
      fail(
        'INVALID_QUERY',
        'Supply a username and optional pagination cursor only.'
      );
    const username = query.username.trim().replace(/^@/, '').toLowerCase();
    if (
      !/^[a-z0-9_](?:[a-z0-9_.]{0,28}[a-z0-9_])?$/.test(username) ||
      username.includes('..')
    )
      fail(
        'INVALID_USERNAME',
        'Enter a valid Instagram username (up to 30 characters).'
      );
    if (
      query.cursor !== undefined &&
      (typeof query.cursor !== 'string' || query.cursor.length > 4096)
    )
      fail('INVALID_CURSOR', 'Search again to restart pagination.');
    const connection = await this.integrations.getIntegrationById(
      orgId,
      integrationId
    );
    if (
      !connection ||
      connection.organizationId !== orgId ||
      connection.deletedAt
    )
      fail('NOT_FOUND', 'Instagram connection not found.', 404);
    if (
      connection.providerIdentifier !== 'instagram' ||
      connection.type !== 'social'
    )
      fail(
        'UNSUPPORTED_PROVIDER',
        'Business Discovery requires Instagram connected through Facebook Login.'
      );
    if (
      connection.disabled ||
      connection.inBetweenSteps ||
      connection.refreshNeeded ||
      !id(connection.internalId) ||
      !connection.refreshToken ||
      !connection.token ||
      !connection.tokenExpiration ||
      connection.tokenExpiration.getTime() <= Date.now()
    )
      fail(
        'RECONNECT_REQUIRED',
        'Reconnect this Instagram channel using Facebook Login, then select its linked Page.',
        409
      );
    const token = connection.refreshToken;
    const context = hash(
      JSON.stringify([
        orgId,
        actorId,
        hash(session),
        integrationId,
        connection.internalId,
        username,
        hash(token),
        hash(connection.token),
      ])
    );
    let after: string | undefined;
    if (query.cursor) {
      try {
        const [payload, signature, extra] = query.cursor.split('.');
        const expected = this.sign(payload);
        if (
          extra ||
          !signature ||
          signature.length !== expected.length ||
          !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
        )
          throw new Error();
        const decoded = JSON.parse(
          Buffer.from(payload, 'base64url').toString()
        );
        if (
          decoded.context !== context ||
          !Number.isSafeInteger(decoded.expires) ||
          decoded.expires <= Date.now() ||
          !cursorPattern.test(decoded.after)
        )
          throw new Error();
        after = decoded.after;
      } catch {
        fail('INVALID_CURSOR', 'Search again to restart pagination.');
      }
    }
    const appId = process.env.FACEBOOK_APP_ID;
    const appSecret = process.env.FACEBOOK_APP_SECRET;
    if (!appId || !appSecret)
      fail('UNAVAILABLE', 'Business Discovery is not configured.', 503);
    const debug = (
      await this.graph('debug_token', `${appId}|${appSecret}`, {
        input_token: token,
      })
    ).data;
    const now = Math.floor(Date.now() / 1000);
    if (
      !debug?.is_valid ||
      debug.type !== 'USER' ||
      debug.app_id !== appId ||
      !id(debug.user_id) ||
      !Number.isFinite(debug.expires_at) ||
      debug.expires_at <= now ||
      !Number.isFinite(debug.data_access_expires_at) ||
      debug.data_access_expires_at <= now
    )
      fail(
        'RECONNECT_REQUIRED',
        'The current Facebook User authorization is missing, expired, or unsuitable. Reconnect this Instagram channel using Facebook Login.',
        409
      );
    if (
      !Array.isArray(debug.scopes) ||
      SCOPES.some((scope) => !debug.scopes.includes(scope))
    )
      fail(
        'MISSING_PERMISSIONS',
        'Reconnect with instagram_basic, instagram_manage_insights, pages_read_engagement and pages_show_list permissions.',
        403
      );
    const user = await this.graph('me', token, { fields: 'id' });
    if (user.id !== debug.user_id)
      fail(
        'RECONNECT_REQUIRED',
        'The Facebook User identity does not match its authorization. Reconnect this channel.',
        409
      );
    // Resolve the relationship with the User credential, never the stored Page token.
    // Do not follow Graph paging URLs or enumerate an unbounded Page collection.
    const pages = await this.graph('me/accounts', token, {
      fields: 'id,instagram_business_account',
      limit: '100',
    });
    const page =
      Array.isArray(pages.data) &&
      pages.data.find(
        (item: any) =>
          id(item.id) &&
          item.instagram_business_account?.id === connection.internalId
      );
    if (!page)
      fail(
        'RECONNECT_REQUIRED',
        'The linked Instagram account is not available among the first 100 authorized Pages. Reconnect and grant access to its linked Page.',
        409
      );
    if (Array.isArray(debug.granular_scopes)) {
      for (const grant of debug.granular_scopes) {
        if (
          SCOPES.includes(grant.scope) &&
          grant.target_ids !== undefined &&
          (!Array.isArray(grant.target_ids) ||
            !grant.target_ids.some(
              (target: unknown) =>
                target === page.id || target === connection.internalId
            ))
        )
          fail(
            'MISSING_PERMISSIONS',
            'The Facebook grant does not include this Instagram account and linked Page. Reconnect and select that Page.',
            403
          );
      }
    }
    const pageDebug = (
      await this.graph('debug_token', `${appId}|${appSecret}`, {
        input_token: connection.token,
      })
    ).data;
    if (
      !pageDebug?.is_valid ||
      pageDebug.app_id !== appId ||
      (pageDebug.type !== undefined && pageDebug.type !== 'PAGE') ||
      (pageDebug.profile_id !== undefined &&
        pageDebug.profile_id !== page.id) ||
      !Number.isFinite(pageDebug.expires_at) ||
      (pageDebug.expires_at !== 0 && pageDebug.expires_at <= now) ||
      (pageDebug.data_access_expires_at !== undefined &&
        (!Number.isFinite(pageDebug.data_access_expires_at) ||
          (pageDebug.data_access_expires_at !== 0 &&
            pageDebug.data_access_expires_at <= now)))
    ) {
      fail(
        'RECONNECT_REQUIRED',
        'The publishing Page authorization is invalid or belongs to a different app. Reconnect this Instagram channel.',
        409
      );
    }
    const publishingPage = await this.graph('me', connection.token, {
      fields: 'id,instagram_business_account',
    });
    if (
      publishingPage.id !== page.id ||
      publishingPage.instagram_business_account?.id !== connection.internalId
    )
      fail(
        'RECONNECT_REQUIRED',
        'The publishing Page and current Facebook User authorization do not match. Reconnect and select the linked Page.',
        409
      );
    const acting = await this.graph(connection.internalId, token, {
      fields: 'id,username',
    });
    if (
      acting.id !== connection.internalId ||
      typeof acting.username !== 'string'
    )
      fail(
        'RECONNECT_REQUIRED',
        'The acting Instagram identity could not be verified. Reconnect this channel.',
        409
      );
    if (acting.username.toLowerCase() === username)
      fail(
        'INVALID_TARGET',
        'Choose a different public professional account. Owner insights are shown separately.'
      );
    const mediaFields =
      'id,caption,media_type,permalink,timestamp,like_count,comments_count,media_url,thumbnail_url';
    const fields = `business_discovery.username(${username}){id,username,biography,website,followers_count,media_count,media.limit(12)${
      after ? `.after(${after})` : ''
    }{${mediaFields}}}`;
    const result = await this.graph(
      connection.internalId,
      token,
      { fields },
      true
    );
    const target = result.business_discovery;
    if (!target)
      fail(
        'TARGET_UNAVAILABLE',
        'No eligible public professional account was returned. Check the username; personal or age-restricted accounts are unavailable.',
        404
      );
    if (
      result.id !== connection.internalId ||
      !id(target.id) ||
      target.id === connection.internalId ||
      typeof target.username !== 'string' ||
      target.username.toLowerCase() !== username ||
      !Array.isArray(target.media?.data) ||
      target.media.data.some((item: any) => !item || !id(item.id))
    )
      fail(
        'UPSTREAM_ERROR',
        'Meta returned incomplete public data. Try again later.',
        502
      );
    const next = target.media.paging?.cursors?.after;
    let nextCursor: string | null = null;
    if (
      typeof next === 'string' &&
      cursorPattern.test(next) &&
      next !== after &&
      target.media.data.length
    ) {
      const payload = Buffer.from(
        JSON.stringify({
          context,
          after: next,
          expires: Date.now() + 15 * 60000,
        })
      ).toString('base64url');
      nextCursor = `${payload}.${this.sign(payload)}`;
    }
    return {
      source: 'public_business_discovery',
      acting: { integrationId, id: acting.id, username: acting.username },
      target: {
        id: target.id,
        username: target.username,
        biography: text(target.biography),
        website: safeUrl(target.website),
        followers: count(target.followers_count),
        mediaCount: count(target.media_count),
      },
      media: target.media.data.slice(0, 12).map((item: any) => ({
        id: item.id,
        caption: text(item.caption),
        mediaType: text(item.media_type),
        permalink: safeUrl(item.permalink),
        timestamp: text(item.timestamp),
        likes: count(item.like_count),
        comments: count(item.comments_count),
        previewUrl: safeUrl(
          item.media_type === 'VIDEO' ? item.thumbnail_url : item.media_url,
          true
        ),
      })),
      nextCursor,
    };
  }
}
