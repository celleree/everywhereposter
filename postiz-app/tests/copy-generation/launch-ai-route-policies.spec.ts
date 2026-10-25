import { CopilotController } from '../../apps/backend/src/api/routes/copilot.controller';
import { MediaController } from '../../apps/backend/src/api/routes/media.controller';
import { PostsController } from '../../apps/backend/src/api/routes/posts.controller';
import { PermissionsService } from '../../apps/backend/src/services/auth/permissions/permissions.service';
import { CHECK_POLICIES_KEY } from '../../apps/backend/src/services/auth/permissions/permissions.ability';
import { PoliciesGuard } from '../../apps/backend/src/services/auth/permissions/permissions.guard';
import { AuthorizationActions, Sections } from '../../apps/backend/src/services/auth/permissions/permission.exception.class';
import { Reflector } from '@nestjs/core';

jest.mock('@copilotkit/runtime', () => ({}));
jest.mock('@ag-ui/mastra', () => ({}));
jest.mock('@gitroom/nestjs-libraries/openai/copilot-model-adapter', () => ({}));
jest.mock('@gitroom/nestjs-libraries/chat/mastra.service', () => ({ MastraService: class {} }));
jest.mock('@gitroom/nestjs-libraries/upload/quick-upload.service', () => ({ QuickUploadService: class {} }));
jest.mock('@gitroom/nestjs-libraries/upload/resumable-upload.service', () => ({ ResumableUploadService: class {} }));
jest.mock('@gitroom/nestjs-libraries/agent/agent.graph.service', () => ({ AgentGraphService: class {} }));
jest.mock('@gitroom/nestjs-libraries/copy-generation/copy-generation.service', () => ({ CopyGenerationService: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/historical-imports/historical-import.service', () => ({ HistoricalImportService: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/posts/posts.service', () => ({ PostsService: class {} }));

it.each([
  ['copilot chat', CopilotController.prototype.chatAgent],
  ['generic video', MediaController.prototype.generateVideo],
  ['post splitting', PostsController.prototype.separatePosts],
])('the real %s route denies execution when AI entitlement is absent', async (_name, handler) => {
  expect(Reflect.getMetadata(CHECK_POLICIES_KEY, handler)).toContainEqual([AuthorizationActions.Create, Sections.AI]);
  const check = jest.fn().mockResolvedValue({ can: () => false });
  const guard = new PoliciesGuard(new Reflector(), { check } as any);
  const context = {
    getHandler: () => handler,
    switchToHttp: () => ({ getRequest: () => ({ path: '/fixture', org: { id: 'org-1', createdAt: new Date(), users: [{ role: 'SUPERADMIN' }] }, query: {} }) }),
  };
  await expect(guard.canActivate(context as any)).rejects.toMatchObject({ response: { section: Sections.AI } });
  expect(check).toHaveBeenCalledWith('org-1', expect.any(Date), 'SUPERADMIN', [[AuthorizationActions.Create, Sections.AI]], undefined, undefined);
});

it.each([
  ['LAUNCH_V1', 'true', false], ['LAUNCH_V1', 'false', false],
  ['PRO', 'true', true], ['STANDARD', 'false', true], ['FREE', 'true', false],
])('post splitting applies the real %s AI policy (billing=%s)', async (tier, billing, allowed) => {
  const previous = process.env.BILLING_ENABLED;
  process.env.BILLING_ENABLED = billing as string;
  try {
    const result = { posts: ['first', 'second'] };
    const posts = { separatePosts: jest.fn().mockResolvedValue(result) };
    const controller = new PostsController(posts as any, {} as any, {} as any, {} as any, {} as any);
    const permissions = new PermissionsService({ getSubscriptionByOrganizationId: async () => ({ subscriptionTier: tier }) } as any,
      {} as any, {} as any, {} as any);
    const guard = new PoliciesGuard(new Reflector(), permissions);
    const org = { id: 'org-fixture', createdAt: new Date(), users: [{ role: 'SUPERADMIN' }] };
    const body = { content: 'first second', len: 10 };
    const context = { getHandler: () => PostsController.prototype.separatePosts,
      switchToHttp: () => ({ getRequest: () => ({ path: '/posts/separate-posts', org, body, query: {} }) }) };
    const dispatch = async () => {
      if (await guard.canActivate(context as any)) return controller.separatePosts(org as any, body);
    };
    if (allowed) {
      await expect(dispatch()).resolves.toBe(result);
      expect(posts.separatePosts).toHaveBeenCalledWith(body.content, body.len);
      expect(posts.separatePosts).toHaveBeenCalledTimes(1);
    } else {
      await expect(dispatch()).rejects.toMatchObject({ status: 402, response: { section: Sections.AI } });
      expect(posts.separatePosts).not.toHaveBeenCalled();
    }
  } finally {
    if (previous === undefined) delete process.env.BILLING_ENABLED; else process.env.BILLING_ENABLED = previous;
  }
});
