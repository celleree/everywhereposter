import { CopilotController } from '../../apps/backend/src/api/routes/copilot.controller';
import { MediaController } from '../../apps/backend/src/api/routes/media.controller';
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

it.each([
  ['copilot chat', CopilotController.prototype.chatAgent],
  ['generic video', MediaController.prototype.generateVideo],
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
