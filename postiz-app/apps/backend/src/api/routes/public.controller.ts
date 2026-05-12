import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  Res,
  StreamableFile,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PostsService } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.service';
import { TrackService } from '@gitroom/nestjs-libraries/track/track.service';
import { RealIP } from 'nestjs-real-ip';
import { UserAgent } from '@gitroom/nestjs-libraries/user/user.agent';
import { TrackEnum } from '@gitroom/nestjs-libraries/user/track.enum';
import { Request, Response } from 'express';
import { makeId } from '@gitroom/nestjs-libraries/services/make.is';
import { getCookieUrlFromDomain } from '@gitroom/helpers/subdomain/subdomain.management';
import { AgentGraphInsertService } from '@gitroom/nestjs-libraries/agent/agent.graph.insert.service';
import { Nowpayments } from '@gitroom/nestjs-libraries/crypto/nowpayments';
import { SubscriptionService } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.service';
import { AuthService } from '@gitroom/helpers/auth/auth.service';
import { pricing } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/pricing';
import { Readable, pipeline } from 'stream';
import { promisify } from 'util';
import { OnlyURL } from '@gitroom/nestjs-libraries/dtos/webhooks/webhooks.dto';
import { isSafePublicHttpsUrl } from '@gitroom/nestjs-libraries/dtos/webhooks/webhook.url.validator';
import { createHmac, timingSafeEqual } from 'crypto';
import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
import { OrganizationService } from '@gitroom/nestjs-libraries/database/prisma/organizations/organization.service';

const pump = promisify(pipeline);
const META_DATA_DELETION_PREFIX = 'meta:data-deletion:';
const META_DATA_DELETION_TTL_SECONDS = 60 * 60 * 24 * 90;

type MetaDeletionStatus = 'completed' | 'not_found';

type MetaDeletionRecord = {
  confirmationCode: string;
  status: MetaDeletionStatus;
  requestedAt: string;
  processedAt: string;
  appScopedUserId: string;
  appSource: 'facebook' | 'threads' | 'instagram-standalone';
  deletedIntegrationCount: number;
  providers: string[];
};

@ApiTags('Public')
@Controller('/public')
export class PublicController {
  constructor(
    private _trackService: TrackService,
    private _agentGraphInsertService: AgentGraphInsertService,
    private _postsService: PostsService,
    private _nowpayments: Nowpayments,
    private _subscriptionService: SubscriptionService,
    private _integrationService: IntegrationService,
    private _organizationService: OrganizationService
  ) {}
  @Post('/agent')
  async createAgent(@Body() body: { text: string; apiKey: string }) {
    if (
      !body.apiKey ||
      !process.env.AGENT_API_KEY ||
      body.apiKey !== process.env.AGENT_API_KEY
    ) {
      return;
    }
    return this._agentGraphInsertService.newPost(body.text);
  }

  @Get(`/posts/:id`)
  async getPreview(@Param('id') id: string, @Req() req: Request) {
    const posts = await this._postsService.getPostsRecursively(id, true);
    const viewerCanAccessAnalytics = await this.viewerCanAccessAnalytics(
      req,
      posts[0]?.organizationId
    );

    return posts.map(
      ({ childrenPost, ...p }, index) => ({
        ...p,
        viewerCanAccessAnalytics:
          index === 0 ? viewerCanAccessAnalytics : false,
        ...(p.integration
          ? {
              integration: {
                id: p.integration.id,
                name: p.integration.name,
                picture: p.integration.picture,
                providerIdentifier: p.integration.providerIdentifier,
                profile: p.integration.profile,
              },
            }
          : {}),
      })
    );
  }

  private async viewerCanAccessAnalytics(
    req: Request,
    organizationId?: string
  ) {
    if (!organizationId) {
      return false;
    }

    const auth = req.cookies?.auth || req.headers.auth;
    if (!auth || Array.isArray(auth)) {
      return false;
    }

    try {
      const user = AuthService.verifyJWT(auth) as {
        id?: string;
        activated?: boolean;
      };
      if (!user?.id || !user.activated) {
        return false;
      }

      const orgHeader = req.cookies?.showorg || req.headers.showorg;
      const orgs = (
        await this._organizationService.getOrgsByUserId(user.id)
      ).filter((org) => !org.users[0]?.disabled);
      const activeOrg = orgs.find((org) => org.id === orgHeader) || orgs[0];

      return activeOrg?.id === organizationId;
    } catch {
      return false;
    }
  }

  @Get(`/posts/:id/comments`)
  async getComments(@Param('id') postId: string) {
    return { comments: await this._postsService.getComments(postId) };
  }

  @Post('/t')
  async trackEvent(
    @Res() res: Response,
    @Req() req: Request,
    @RealIP() ip: string,
    @UserAgent() userAgent: string,
    @Body()
    body: { fbclid?: string; tt: TrackEnum; additional: Record<string, any> }
  ) {
    const uniqueId = req?.cookies?.track || makeId(10);
    const fbclid = req?.cookies?.fbclid || body.fbclid;
    await this._trackService.track(
      uniqueId,
      ip,
      userAgent,
      body.tt,
      body.additional,
      fbclid
    );
    if (!req.cookies.track) {
      res.cookie('track', uniqueId, {
        domain: getCookieUrlFromDomain(process.env.FRONTEND_URL!),
        ...(!process.env.NOT_SECURED
          ? {
              secure: true,
              httpOnly: true,
            }
          : {}),
        sameSite: 'none',
        expires: new Date(Date.now() + 1000 * 60 * 60 * 24 * 365),
      });
    }

    if (body.fbclid && !req.cookies.fbclid) {
      res.cookie('fbclid', body.fbclid, {
        domain: getCookieUrlFromDomain(process.env.FRONTEND_URL!),
        ...(!process.env.NOT_SECURED
          ? {
              secure: true,
              httpOnly: true,
            }
          : {}),
        sameSite: 'none',
        expires: new Date(Date.now() + 1000 * 60 * 60 * 24 * 365),
      });
    }

    res.status(200).json({
      track: uniqueId,
    });
  }

  @Post('/modify-subscription')
  async modifySubscription(@Body('params') params: string) {
    try {
      const load = AuthService.verifyJWT(params) as {
        orgId: string;
        billing: 'FREE' | 'STANDARD' | 'TEAM' | 'PRO' | 'ULTIMATE';
      };

      if (!load || !load.orgId || !load.billing || !pricing[load.billing]) {
        return { success: false };
      }

      const totalChannels = pricing[load.billing].channel || 0;

      await this._subscriptionService.modifySubscriptionByOrg(
        load.orgId,
        totalChannels,
        load.billing
      );

      return { success: true };
    } catch (err) {
      return { success: false };
    }
  }

  @Post('/meta/data-deletion')
  async metaDataDeletionCallback(
    @Body() body: { signed_request?: string },
    @Req() req: Request,
    @Res() res: Response
  ) {
    const signedRequest = this.getSignedRequest(body, req);
    if (!signedRequest) {
      return res.status(400).json({
        error: 'Missing signed_request',
      });
    }

    try {
      const { payload, source } = this.parseMetaSignedRequest(signedRequest);
      const appScopedUserId = String(payload?.user_id || '');
      if (!appScopedUserId) {
        return res.status(400).json({
          error: 'Missing user_id in signed_request payload',
        });
      }

      const providers = this.getProviderIdentifiersForMetaSource(source);
      const deletedIntegrations =
        await this._integrationService.scrubIntegrationsForMetaUser(
          appScopedUserId,
          providers
        );

      const confirmationCode = makeId(24);
      const now = new Date().toISOString();
      const record: MetaDeletionRecord = {
        confirmationCode,
        status: deletedIntegrations.length ? 'completed' : 'not_found',
        requestedAt: now,
        processedAt: now,
        appScopedUserId,
        appSource: source,
        deletedIntegrationCount: deletedIntegrations.length,
        providers: Array.from(
          new Set(deletedIntegrations.map((integration) => integration.providerIdentifier))
        ),
      };

      await ioRedis.set(
        `${META_DATA_DELETION_PREFIX}${confirmationCode}`,
        JSON.stringify(record),
        'EX',
        META_DATA_DELETION_TTL_SECONDS
      );

      return res.status(200).json({
        url: `${process.env.FRONTEND_URL}/api/public/meta/data-deletion/status?code=${confirmationCode}`,
        confirmation_code: confirmationCode,
      });
    } catch (error) {
      return res.status(400).json({
        error: 'Invalid signed_request',
      });
    }
  }

  @Get('/meta/data-deletion/status')
  async metaDataDeletionStatus(
    @Query('code') code: string,
    @Res() res: Response
  ) {
    const record = await this.getMetaDeletionRecord(code);
    res.type('html').send(this.renderMetaDeletionStatusPage(code, record));
  }

  @Post('/crypto/:path')
  async cryptoPost(@Body() body: any, @Param('path') path: string) {
    console.log('cryptoPost', body, path);
    return this._nowpayments.processPayment(path, body);
  }

  @Get('/stream')
  async streamFile(
    @Query() query: OnlyURL,
    @Res() res: Response,
    @Req() req: Request
  ) {
    const { url } = query;
    if (!url.endsWith('mp4')) {
      return res.status(400).send('Invalid video URL');
    }

    const ac = new AbortController();
    const onClose = () => ac.abort();
    req.on('aborted', onClose);
    res.on('close', onClose);

    // Manually follow redirects so every hop is re-validated against
    // the SSRF blocklist (see GHSA-34w8-5j2v-h6ww). `fetch` defaults to
    // `redirect: 'follow'`, which bypasses the DTO-level URL check.
    const MAX_REDIRECTS = 5;
    let currentUrl = url;
    let r: globalThis.Response | undefined;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      if (!(await isSafePublicHttpsUrl(currentUrl))) {
        return res.status(400).send('Blocked URL');
      }

      r = await fetch(currentUrl, {
        signal: ac.signal,
        redirect: 'manual',
      });

      if (r.status >= 300 && r.status < 400) {
        const location = r.headers.get('location');
        if (!location) {
          return res.status(502).send('Redirect without Location');
        }
        try {
          currentUrl = new URL(location, currentUrl).toString();
        } catch {
          return res.status(400).send('Invalid redirect target');
        }
        continue;
      }

      break;
    }

    if (!r) {
      return res.status(502).send('No upstream response');
    }

    if (r.status >= 300 && r.status < 400) {
      return res.status(508).send('Too many redirects');
    }

    if (!r.ok && r.status !== 206) {
      res.status(r.status);
      throw new Error(`Upstream error: ${r.statusText}`);
    }

    const type = r.headers.get('content-type') ?? 'application/octet-stream';
    res.setHeader('Content-Type', type);

    const contentRange = r.headers.get('content-range');
    if (contentRange) res.setHeader('Content-Range', contentRange);

    const len = r.headers.get('content-length');
    if (len) res.setHeader('Content-Length', len);

    const acceptRanges = r.headers.get('accept-ranges') ?? 'bytes';
    res.setHeader('Accept-Ranges', acceptRanges);

    if (r.status === 206) res.status(206); // Partial Content for range responses

    try {
      await pump(Readable.fromWeb(r.body as any), res);
    } catch (err) {}
  }

  private getSignedRequest(
    body: { signed_request?: string } | undefined,
    req: Request
  ) {
    if (body?.signed_request) {
      return body.signed_request;
    }

    const rawBody = (req as any)?.rawBody;
    if (Buffer.isBuffer(rawBody)) {
      return new URLSearchParams(rawBody.toString('utf8')).get('signed_request');
    }

    if (typeof rawBody === 'string') {
      return new URLSearchParams(rawBody).get('signed_request');
    }

    return undefined;
  }

  private parseMetaSignedRequest(signedRequest: string) {
    const [encodedSignature, encodedPayload] = signedRequest.split('.', 2);
    if (!encodedSignature || !encodedPayload) {
      throw new Error('Malformed signed_request');
    }

    const signature = this.base64UrlDecodeToBuffer(encodedSignature);
    const payloadBuffer = this.base64UrlDecodeToBuffer(encodedPayload);

    for (const secret of this.getMetaAppSecrets()) {
      const expected = createHmac('sha256', secret.value)
        .update(encodedPayload)
        .digest();

      if (
        signature.length === expected.length &&
        timingSafeEqual(signature, expected)
      ) {
        const payload = JSON.parse(payloadBuffer.toString('utf8'));
        if (payload?.algorithm && payload.algorithm !== 'HMAC-SHA256') {
          throw new Error('Unsupported signed_request algorithm');
        }

        return {
          payload,
          source: secret.source,
        };
      }
    }

    throw new Error('Signed request verification failed');
  }

  private getMetaAppSecrets() {
    return [
      {
        source: 'facebook' as const,
        value: process.env.FACEBOOK_APP_SECRET,
      },
      {
        source: 'threads' as const,
        value: process.env.THREADS_APP_SECRET,
      },
      {
        source: 'instagram-standalone' as const,
        value: process.env.INSTAGRAM_APP_SECRET,
      },
    ].filter((secret) => !!secret.value) as {
      source: 'facebook' | 'threads' | 'instagram-standalone';
      value: string;
    }[];
  }

  private getProviderIdentifiersForMetaSource(
    source: 'facebook' | 'threads' | 'instagram-standalone'
  ) {
    switch (source) {
      case 'facebook':
        return ['facebook', 'instagram'];
      case 'threads':
        return ['threads'];
      case 'instagram-standalone':
        return ['instagram-standalone'];
    }
  }

  private base64UrlDecodeToBuffer(value: string) {
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
    const padLength = (4 - (normalized.length % 4)) % 4;
    return Buffer.from(`${normalized}${'='.repeat(padLength)}`, 'base64');
  }

  private async getMetaDeletionRecord(code: string) {
    if (!code) {
      return undefined;
    }

    const stored = await ioRedis.get(`${META_DATA_DELETION_PREFIX}${code}`);
    if (!stored) {
      return undefined;
    }

    try {
      return JSON.parse(stored) as MetaDeletionRecord;
    } catch {
      return undefined;
    }
  }

  private renderMetaDeletionStatusPage(
    code: string,
    record: MetaDeletionRecord | undefined
  ) {
    const title = record
      ? 'Meta Data Deletion Request'
      : 'Deletion Request Not Found';
    const summary = !record
      ? 'We could not find a deletion request for that confirmation code.'
      : record.status === 'completed'
      ? 'Your deletion request was received and matching Meta-connected data has been removed from Publish Everywhere.'
      : 'Your deletion request was received. We did not find any matching Meta-connected data in Publish Everywhere, so no further action was required.';
    const detail = !record
      ? 'The code may be missing, invalid, or older than our retention window for status lookups.'
      : record.status === 'completed'
      ? `Deleted connections: ${record.deletedIntegrationCount}.`
      : 'Meta may sometimes send identifiers that are not present in our records. When that happens, the request is treated as already satisfied.';
    const requestedAt = record ? this.formatMetaDeletionDate(record.requestedAt) : 'Unavailable';
    const processedAt = record ? this.formatMetaDeletionDate(record.processedAt) : 'Unavailable';
    const providers =
      record && record.providers.length
        ? record.providers.join(', ')
        : record
        ? 'None matched'
        : 'Unavailable';

    return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${this.escapeHtml(title)} | Publish Everywhere</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #f4f1ea;
        --paper: rgba(255, 253, 248, 0.95);
        --text: #1f2933;
        --muted: #52606d;
        --line: #d9d1c3;
        --accent: #205c44;
        --accent-soft: #dcefe6;
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        font-family: Georgia, "Times New Roman", serif;
        background:
          radial-gradient(circle at top right, rgba(32, 92, 68, 0.14), transparent 32%),
          linear-gradient(180deg, #faf8f2 0%, var(--bg) 100%);
        color: var(--text);
        line-height: 1.7;
      }

      main {
        width: min(760px, calc(100% - 32px));
        margin: 48px auto;
      }

      .card {
        background: var(--paper);
        border: 1px solid rgba(217, 209, 195, 0.9);
        border-radius: 24px;
        padding: 32px;
        box-shadow: 0 22px 50px rgba(31, 41, 51, 0.09);
      }

      .eyebrow {
        display: inline-block;
        margin: 0 0 10px;
        padding: 6px 10px;
        border-radius: 999px;
        background: var(--accent-soft);
        color: var(--accent);
        font-family: Arial, sans-serif;
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }

      h1 {
        margin: 0;
        font-size: clamp(2rem, 4vw, 3rem);
        line-height: 1.08;
      }

      p {
        margin: 14px 0 0;
      }

      dl {
        margin: 28px 0 0;
      }

      dt {
        margin-top: 18px;
        font-size: 0.9rem;
        font-weight: 700;
        color: var(--muted);
        letter-spacing: 0.04em;
        text-transform: uppercase;
      }

      dd {
        margin: 6px 0 0;
      }

      a {
        color: var(--accent);
      }

      @media (max-width: 640px) {
        main {
          width: min(100% - 20px, 760px);
          margin: 20px auto;
        }

        .card {
          border-radius: 18px;
          padding: 24px 20px;
        }
      }
    </style>
  </head>
  <body>
    <main>
      <section class="card">
        <p class="eyebrow">Publish Everywhere</p>
        <h1>${this.escapeHtml(title)}</h1>
        <p>${this.escapeHtml(summary)}</p>
        <p>${this.escapeHtml(detail)}</p>
        <dl>
          <dt>Confirmation Code</dt>
          <dd>${this.escapeHtml(code || 'Unavailable')}</dd>
          <dt>Requested</dt>
          <dd>${this.escapeHtml(requestedAt)}</dd>
          <dt>Processed</dt>
          <dd>${this.escapeHtml(processedAt)}</dd>
          <dt>Matched Providers</dt>
          <dd>${this.escapeHtml(providers)}</dd>
        </dl>
        <p>
          Questions can be sent to
          <a href="mailto:arundelkramer@gmail.com">arundelkramer@gmail.com</a>.
        </p>
      </section>
    </main>
  </body>
</html>`;
  }

  private formatMetaDeletionDate(value: string) {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      return 'Unavailable';
    }

    return parsed.toUTCString();
  }

  private escapeHtml(value: string) {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
}
