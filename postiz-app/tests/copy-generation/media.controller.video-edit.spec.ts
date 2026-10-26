import { ValidationPipe } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { MediaController } from '@gitroom/backend/api/routes/media.controller';
import { CookedReviewController } from '@gitroom/backend/api/routes/cooked-review.controller';
import { CHECK_POLICIES_KEY } from '@gitroom/backend/services/auth/permissions/permissions.ability';
import { AuthorizationActions, Sections, SubscriptionException } from '@gitroom/backend/services/auth/permissions/permission.exception.class';
import { PermissionsService } from '@gitroom/backend/services/auth/permissions/permissions.service';
import { PoliciesGuard } from '@gitroom/backend/services/auth/permissions/permissions.guard';
import { SubscriptionExceptionFilter } from '@gitroom/backend/services/auth/permissions/subscription.exception';
import { CookedReviewService } from '@gitroom/nestjs-libraries/media-editing/cooked-review.service';
import { UploadFactory } from '@gitroom/nestjs-libraries/upload/upload.factory';
import { CreateVideoEditDto } from '../../libraries/nestjs-libraries/src/dtos/media/create-video-edit.dto';

describe('Video Editor API contract', () => {
  const keys = ['BILLING_ENABLED', 'FRONTEND_URL', 'COOKED_EDITOR_ENABLED', 'COOKED_EDITOR_ORGANIZATIONS', 'COOKED_EDITOR_SOCKET'];
  let previous: (string | undefined)[];
  beforeEach(() => {
    previous = keys.map(key => process.env[key]);
    process.env.BILLING_ENABLED = 'true'; process.env.FRONTEND_URL = 'https://editor.example.test';
    jest.spyOn(UploadFactory, 'createStorage').mockReturnValue({} as any);
  });
  afterEach(() => {
    keys.forEach((key, i) => previous[i] === undefined ? delete process.env[key] : process.env[key] = previous[i]);
    jest.restoreAllMocks();
  });
  it('uses local editing for Standard while generic generation retains AI', async () => {
    expect(Reflect.getMetadata(CHECK_POLICIES_KEY, MediaController.prototype.createVideoEdit)).toEqual([[AuthorizationActions.Create, Sections.LOCAL_VIDEO_EDIT]]);
    expect(Reflect.getMetadata(CHECK_POLICIES_KEY, MediaController.prototype.generateVideo)).toEqual([[AuthorizationActions.Create, Sections.AI]]);
    expect(Reflect.getMetadata(CHECK_POLICIES_KEY, CookedReviewController.prototype.status)).toBeUndefined();
    const create = jest.fn();
    const controller = new MediaController({} as any, {} as any, {} as any, {} as any, {} as any, { create } as any, {} as any);
    controller.createVideoEdit({ id: 'request-org' } as any, 'source', { schemaVersion: 1 });
    expect(create).toHaveBeenCalledWith('request-org', 'source', { schemaVersion: 1 });
  });
  it('validates schema and preset through the runtime pipe', async () => {
    const pipe = new ValidationPipe({ transform: true });
    const metadata = { type: 'body' as const, metatype: CreateVideoEditDto };
    await expect(pipe.transform({ schemaVersion: 1 }, metadata)).resolves.toMatchObject({ schemaVersion: 1 });
    await expect(pipe.transform({ schemaVersion: 2 }, metadata)).rejects.toMatchObject({ status: 400 });
    await expect(pipe.transform({ schemaVersion: 1, pacingPreset: 'unsafe' }, metadata)).rejects.toMatchObject({ status: 400 });
  });

  const routes = ['standard', 'find', 'create', 'edit', 'output', 'remove', 'view'] as const;
  it.each(['studioJobs', 'studioJob', 'reviewStudio', 'cancelStudio'] as const)('requires the local-editor grant on Studio %s', name => {
    expect(Reflect.getMetadata(CHECK_POLICIES_KEY, MediaController.prototype[name])).toEqual([[AuthorizationActions.Create, Sections.LOCAL_VIDEO_EDIT]]);
  });
  type Route = typeof routes[number];
  function fixture(editor?: CookedReviewService) {
    const calls = Object.fromEntries(routes.map(name => [name, jest.fn().mockResolvedValue({ bytes: Buffer.from('{}') })]));
    const subscription = { getSubscriptionByOrganizationId: jest.fn().mockResolvedValue({ subscriptionTier: 'LAUNCH_V1' }) };
    const permissions = new PermissionsService(subscription as any, {} as any, {} as any, {} as any);
    const guard = new PoliciesGuard(new Reflector(), permissions);
    const transcription = { ensureTranscriptionStarted: jest.fn(), retry: jest.fn() };
    const media = new MediaController({} as any, {} as any, {} as any, {} as any, transcription as any, { create: calls.standard } as any, {} as any);
    const cooked = new CookedReviewController(editor || calls as any);
    const org = { id: 'request-org', createdAt: new Date(), users: [{ role: 'USER' }] };
    const request = { path: '/media/editor-fixture', org, query: {}, headers: { origin: process.env.FRONTEND_URL } };
    const response = { setHeader: jest.fn(), type: jest.fn(), send: jest.fn() };
    const uuid = '11111111-1111-4111-8111-111111111111';
    const invoke = (name: Route) => {
      switch (name) {
        case 'standard': return media.createVideoEdit(org as any, 'source', { schemaVersion: 1 });
        case 'find': return cooked.find(org as any, 'source', uuid);
        case 'create': return cooked.create(org as any, 'source', request as any, { requestId: uuid });
        case 'edit': return cooked.edit(org as any, 'source', uuid, request as any, {});
        case 'output': return cooked.output(org as any, 'source', uuid, request as any, { revision: 1 });
        case 'remove': return cooked.remove(org as any, 'source', uuid, request as any);
        case 'view': return cooked.view(org as any, 'source', uuid, 'state', undefined as any, request as any, response as any);
      }
    };
    const handler = (name: Route) => name === 'standard' ? MediaController.prototype.createVideoEdit : CookedReviewController.prototype[name];
    const dispatch = async (name: Route) => {
      await guard.canActivate({ getHandler: () => handler(name), switchToHttp: () => ({ getRequest: () => request }) } as any);
      return invoke(name);
    };
    return { calls, subscription, transcription, request, handler, dispatch };
  }

  it.each(routes)('checks the current grant before %s dispatch, including revocation and lookup failure', async name => {
    const f = fixture();
    expect(Reflect.getMetadata(CHECK_POLICIES_KEY, f.handler(name))).toEqual([[AuthorizationActions.Create, Sections.LOCAL_VIDEO_EDIT]]);
    await f.dispatch(name);
    expect(f.calls[name].mock.calls[0].slice(0, 2)).toEqual(['request-org', 'source']);
    f.subscription.getSubscriptionByOrganizationId.mockResolvedValue(null);
    await expect(f.dispatch(name)).rejects.toMatchObject({ status: 402, response: { section: Sections.LOCAL_VIDEO_EDIT } });
    f.subscription.getSubscriptionByOrganizationId.mockRejectedValue(new Error('fixture lookup failure'));
    await expect(f.dispatch(name)).rejects.toThrow('fixture lookup failure');
    expect(f.subscription.getSubscriptionByOrganizationId).toHaveBeenCalledTimes(3);
    expect(f.calls[name]).toHaveBeenCalledTimes(1);
    for (const call of Object.values(f.transcription)) expect(call).not.toHaveBeenCalled();
  });

  it('does not dispatch with a missing request organization', async () => {
    const f = fixture(); f.request.org = undefined as any;
    await expect(f.dispatch('standard')).rejects.toThrow();
    expect(f.calls.standard).not.toHaveBeenCalled();
    expect(f.subscription.getSubscriptionByOrganizationId).not.toHaveBeenCalled();
  });

  it.each(['create', 'edit', 'output', 'remove'] as const)('keeps same-origin enforcement on Cooked %s', async name => {
    const f = fixture(); f.request.headers.origin = 'https://foreign.example.test';
    await expect(f.dispatch(name)).rejects.toMatchObject({ status: 403 });
    expect(f.calls[name]).not.toHaveBeenCalled();
  });

  it.each(['disabled', 'foreign-org', 'unconfigured'] as const)('a local grant does not bypass the %s Cooked runtime gate', async mode => {
    process.env.COOKED_EDITOR_ENABLED = mode === 'disabled' ? 'false' : 'true';
    process.env.COOKED_EDITOR_ORGANIZATIONS = mode === 'foreign-org' ? 'different-org' : 'request-org';
    process.env.COOKED_EDITOR_SOCKET = mode === 'unconfigured' ? '' : process.cwd();
    const media = { getMediaByOrganizationIdAndId: jest.fn().mockResolvedValue({ type: 'video' }) };
    const editor = new CookedReviewService(media as any, {} as any);
    const configuration = jest.spyOn(editor as any, 'configuration');
    const f = fixture(editor);
    await expect(f.dispatch('find')).rejects.toMatchObject({ status: 503 });
    expect(media.getMediaByOrganizationIdAndId).toHaveBeenCalledWith('request-org', 'source');
    expect(configuration).toHaveBeenCalledWith('request-org');
    expect(configuration.mock.results[0].type).toBe('throw');
  });

  it('keeps Cooked source ownership ahead of worker access', async () => {
    const editor = new CookedReviewService({ getMediaByOrganizationIdAndId: async () => null } as any, {} as any);
    const client = jest.spyOn(editor as any, 'client');
    await expect(fixture(editor).dispatch('find')).rejects.toMatchObject({ status: 404 });
    expect(client).not.toHaveBeenCalled();
  });

  it('returns the existing 402 contract with a readable local-editor denial', () => {
    const response = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    new SubscriptionExceptionFilter().catch(new SubscriptionException({ section: Sections.LOCAL_VIDEO_EDIT, action: AuthorizationActions.Create }),
      { switchToHttp: () => ({ getResponse: () => response }) } as any);
    expect(response.status).toHaveBeenCalledWith(402);
    expect(response.json).toHaveBeenCalledWith({ statusCode: 402,
      message: 'Your current subscription does not include local video editing. Please review your subscription to use the editor.',
      url: 'https://editor.example.test/billing' });
  });
});
