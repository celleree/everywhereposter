import { Body, Controller, Delete, Get, Param, Post, Query, Req, Res, ForbiddenException, NotFoundException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { pipeline } from 'stream/promises';
import { Organization } from '@prisma/client';
import { GetOrgFromRequest } from '@gitroom/nestjs-libraries/user/org.from.request';
import { CookedReviewService } from '@gitroom/nestjs-libraries/media-editing/cooked-review.service';
import { CheckPolicies } from '@gitroom/backend/services/auth/permissions/permissions.ability';
import { AuthorizationActions, Sections } from '@gitroom/backend/services/auth/permissions/permission.exception.class';

function origin(req: Request) {
  try { if (req.headers.origin === new URL(process.env.FRONTEND_URL!).origin) return; } catch {}
  throw new ForbiddenException('Use the editor from this application.');
}
@Controller('/media/cooked')
export class CookedReviewController {
  constructor(private readonly editor: CookedReviewService) {}
  @Get('/status')
  status(@GetOrgFromRequest() org: Organization) { return this.editor.status(org.id); }
  @Get('/:id/find')
  @CheckPolicies([AuthorizationActions.Create, Sections.AI])
  find(@GetOrgFromRequest() org: Organization, @Param('id') id: string, @Query('request') request: string) { return this.editor.find(org.id, id, request); }
  @Post('/:id')
  @CheckPolicies([AuthorizationActions.Create, Sections.AI])
  create(@GetOrgFromRequest() org: Organization, @Param('id') id: string, @Req() req: Request, @Body() body: { requestId: string }) { origin(req); return this.editor.create(org.id, id, body); }
  @Post('/:id/:job/edits')
  @CheckPolicies([AuthorizationActions.Create, Sections.AI])
  edit(@GetOrgFromRequest() org: Organization, @Param('id') id: string, @Param('job') job: string, @Req() req: Request, @Body() body: unknown) { origin(req); return this.editor.edit(org.id, id, job, body); }
  @Post('/:id/:job/output')
  @CheckPolicies([AuthorizationActions.Create, Sections.AI])
  output(@GetOrgFromRequest() org: Organization, @Param('id') id: string, @Param('job') job: string, @Req() req: Request, @Body() body: { revision: number }) { origin(req); return this.editor.output(org.id, id, job, body); }
  @Delete('/:id/request/:job')
  @CheckPolicies([AuthorizationActions.Create, Sections.AI])
  remove(@GetOrgFromRequest() org: Organization, @Param('id') id: string, @Param('job') job: string, @Req() req: Request) { origin(req); return this.editor.remove(org.id, id, job); }
  @Get('/:id/:job/:view')
  @CheckPolicies([AuthorizationActions.Create, Sections.AI])
  async view(@GetOrgFromRequest() org: Organization, @Param('id') id: string, @Param('job') job: string, @Param('view') view: string,
    @Query('k') key: string, @Req() req: Request, @Res() res: Response) {
    const result = await this.editor.view(org.id, id, job, view, key, req.headers.range);
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
    if (result.stream) {
      res.type('video/mp4'); res.setHeader('Accept-Ranges', 'bytes');
      const stream = result.stream; res.status(stream.statusCode || 200);
      for (const name of ['content-length', 'content-range']) if (stream.headers[name]) res.setHeader(name, stream.headers[name]!);
      req.once('aborted', () => stream.destroy()); await pipeline(stream, res); return;
    }
    res.type(view === 'review' ? 'html' : 'json');
    if (view === 'review') res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' data:; media-src 'self' blob:; connect-src 'self'; frame-ancestors 'self'; base-uri 'none'; form-action 'none'");
    res.send(result.bytes);
  }
}
