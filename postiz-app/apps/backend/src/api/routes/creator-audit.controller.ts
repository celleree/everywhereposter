import { Controller, Get, Post, Req, Res, HttpException, Optional } from '@nestjs/common';
import { Request, Response } from 'express';
import { CheckPolicies } from '@gitroom/backend/services/auth/permissions/permissions.ability';
import { AuthorizationActions, Sections } from '@gitroom/backend/services/auth/permissions/permission.exception.class';
import { auditAssertion, auditRouteAllowed, creatorAuditConfig } from './creator-audit.proxy';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
import { ConnectedAuditJobs } from './creator-audit.connected';

@Controller('/creator-audit')
export class CreatorAuditController {
  private readonly connectedJobs: ConnectedAuditJobs;
  constructor(@Optional() integrations?: IntegrationService) {
    this.connectedJobs = new ConnectedAuditJobs((org, id) => {
      if (!integrations) throw new HttpException('Audit connections are unavailable.', 503);
      return integrations.getIntegrationById(org, id);
    });
  }
  // Configuration discovery must never open the shared payment-required UI.
  @Get('/status')
  status() { return { enabled: Boolean(creatorAuditConfig()) }; }

  @Post('/connected')
  @CheckPolicies([AuthorizationActions.Create, Sections.AI], [AuthorizationActions.Create, Sections.ADMIN])
  async connected(@Req() req: Request, @Res() res: Response) {
    if (!creatorAuditConfig()) throw new HttpException('Creator Audit is unavailable.', 404);
    const { org, user } = req as Request & { org?: { id: string; users: { userId: string; role: string; disabled?: boolean }[] }; user?: { id: string } };
    const member = org?.users.find(entry => entry.userId === user?.id && !entry.disabled);
    if (!org?.id || !user?.id || !member || !['ADMIN', 'SUPERADMIN'].includes(member.role)) throw new HttpException('An administrator must start audit work.', 403);
    if (req.headers['x-audit-organization'] !== org.id) throw new HttpException('Workspace changed. Reload Creator Audit.', 409);
    let origin: string;
    try { origin = new URL(process.env.FRONTEND_URL || '').origin; } catch { throw new HttpException('Audit origin unavailable.', 503); }
    if (req.headers.origin !== origin || req.headers['sec-fetch-site'] === 'cross-site') throw new HttpException('Cross-origin audit writes are forbidden.', 403);
    if (Buffer.byteLength(JSON.stringify(req.body ?? {})) > 1024) throw new HttpException('Audit request too large.', 413);
    const task = await this.connectedJobs.start(org.id, user.id, req.body);
    res.setHeader('Cache-Control', 'no-store');
    return res.status(202).send(task);
  }

  @Get('/*')
  @CheckPolicies([AuthorizationActions.Read, Sections.AI])
  read(@Req() req: Request, @Res() res: Response) { return this.proxy(req, res); }

  @Post('/*')
  @CheckPolicies([AuthorizationActions.Create, Sections.AI], [AuthorizationActions.Create, Sections.ADMIN])
  write(@Req() req: Request, @Res() res: Response) { return this.proxy(req, res); }

  async proxy(req: Request, res: Response) {
    const config = creatorAuditConfig();
    if (!config) throw new HttpException('Creator Audit is unavailable.', 404);
    const path = req.path.replace(/^\/creator-audit/, '');
    if (!auditRouteAllowed(req.method, path) || req.url.includes('?')) throw new HttpException('Audit route unavailable.', 404);
    const { org, user } = req as Request & { org?: { id: string; users: { userId: string; role: string; disabled?: boolean }[] }; user?: { id: string } };
    const member = org?.users.find((entry) => entry.userId === user?.id && !entry.disabled);
    if (!org?.id || !user?.id || !member) throw new HttpException('Unauthorized.', 403);
    const writable = ['ADMIN', 'SUPERADMIN'].includes(member.role);
    const isDocument = path === '/audit' || path === '/static/audit-results.js';
    if (!isDocument && req.headers['x-audit-organization'] !== org.id) throw new HttpException('Workspace changed. Reload Creator Audit.', 409);
    if (req.method === 'POST') {
      if (!writable) throw new HttpException('An administrator must start audit work.', 403);
      let origin: string;
      try { origin = new URL(process.env.FRONTEND_URL || '').origin; } catch { throw new HttpException('Audit origin unavailable.', 503); }
      if (req.headers.origin !== origin || req.headers['sec-fetch-site'] === 'cross-site') throw new HttpException('Cross-origin audit writes are forbidden.', 403);
    }
    const taskId = /^\/api\/audit\/tasks\/([a-f0-9]{32})$/.exec(path)?.[1];
    if (req.method === 'GET') {
      let local: unknown;
      if (path === '/api/audit/tasks/current' && this.connectedJobs.current(org.id)) local = { id: this.connectedJobs.current(org.id) };
      else if (taskId && this.connectedJobs.owns(taskId, org.id) && !this.connectedJobs.submitted(taskId, org.id)) local = this.connectedJobs.view(taskId, org.id);
      if (local) {
        res.setHeader('Cache-Control', 'no-store'); res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('X-Content-Type-Options', 'nosniff'); return res.status(200).send(JSON.stringify(local));
      }
    }
    const body = req.method === 'POST' ? JSON.stringify(req.body ?? {}) : '';
    if (Buffer.byteLength(body) > 16_384) throw new HttpException('Audit request too large.', 413);
    let upstream: globalThis.Response;
    try {
      upstream = await fetch(config.origin + path, { method: req.method, redirect: 'manual', signal: AbortSignal.timeout(30_000),
        headers: { Authorization: 'Bearer ' + auditAssertion(config.secret, org.id, user.id, req.method, path, body, writable),
          ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body } : {}) });
    } catch { throw new HttpException('Creator Audit cannot be reached. Try again later.', 502); }
    // Never forward Location, cookies, arbitrary upstream headers or raw errors.
    if (upstream.status >= 300 && upstream.status < 400) throw new HttpException('Unexpected audit service response.', 502);
    if (upstream.status >= 500 || [401, 403].includes(upstream.status)) throw new HttpException('Creator Audit needs operator attention.', 502);
    if (req.method === 'GET' && upstream.status === 404 && taskId && this.connectedJobs.owns(taskId, org.id)) {
      res.setHeader('Cache-Control', 'no-store'); res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      return res.status(200).send(JSON.stringify(this.connectedJobs.view(taskId, org.id)));
    }
    const type = upstream.headers.get('content-type') || '';
    const expected = path === '/audit' ? 'text/html' : path === '/static/audit-results.js' ? 'javascript' : 'application/json';
    if (!(path === '/static/audit-results.js' ? ['text/javascript', 'application/javascript'].includes(type.split(';')[0]) : type.split(';')[0] === expected)) throw new HttpException('Unexpected audit service response.', 502);
    const reader = upstream.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    if (reader) {
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > 2_000_000) { await reader.cancel(); throw new Error('Response too large'); }
          chunks.push(value);
        }
      } catch { throw new HttpException('Unexpected audit service response.', 502); }
      finally { reader.releaseLock(); }
    }
    let responseBody = Buffer.concat(chunks).toString('utf8');
    if (taskId && this.connectedJobs.owns(taskId, org.id)) {
      try {
        const payload = JSON.parse(responseBody);
        if (['done', 'error'].includes(payload.status)) this.connectedJobs.finished(taskId, org.id);
        responseBody = JSON.stringify({ ...payload, ...this.connectedJobs.identity(taskId, org.id) });
      } catch { throw new HttpException('Unexpected audit service response.', 502); }
    }
    res.setHeader('Content-Type', (expected === 'javascript' ? 'text/javascript' : expected) + '; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'self'; object-src 'none'; base-uri 'none'; form-action 'none'");
    return res.status(upstream.status).send(responseBody);
  }
}
