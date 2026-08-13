import 'reflect-metadata';
import { MediaController } from '@gitroom/backend/api/routes/media.controller';
import {
  CHECK_POLICIES_KEY,
} from '@gitroom/backend/services/auth/permissions/permissions.ability';
import {
  AuthorizationActions,
  Sections,
} from '@gitroom/backend/services/auth/permissions/permission.exception.class';

describe('MediaController talking-head edit authorization', () => {
  it('requires the existing AI create capability', () => {
    expect(
      Reflect.getMetadata(
        CHECK_POLICIES_KEY,
        MediaController.prototype.createTalkingHeadEdit
      )
    ).toEqual([[AuthorizationActions.Create, Sections.AI]]);
  });
});
