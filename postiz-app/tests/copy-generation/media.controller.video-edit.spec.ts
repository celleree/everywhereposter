import { ValidationPipe } from '@nestjs/common';
import { MediaController } from '@gitroom/backend/api/routes/media.controller';
import { CHECK_POLICIES_KEY } from '@gitroom/backend/services/auth/permissions/permissions.ability';
import { AuthorizationActions, Sections } from '@gitroom/backend/services/auth/permissions/permission.exception.class';
import { CreateVideoEditDto } from '../../libraries/nestjs-libraries/src/dtos/media/create-video-edit.dto';

describe('Video Editor API contract', () => {
  it('uses the existing AI create capability and request organization', async () => {
    expect(Reflect.getMetadata(CHECK_POLICIES_KEY, MediaController.prototype.createVideoEdit)).toEqual([[AuthorizationActions.Create, Sections.AI]]);
    const create = jest.fn();
    const controller = new MediaController({} as any, {} as any, {} as any, {} as any, {} as any, { create } as any);
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
});
