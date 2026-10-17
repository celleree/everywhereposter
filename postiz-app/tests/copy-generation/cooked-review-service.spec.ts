import { randomUUID } from 'crypto';
import { tmpdir } from 'os';
import { join } from 'path';
import { CookedReviewService } from '../../libraries/nestjs-libraries/src/media-editing/cooked-review.service';
import { UploadFactory } from '../../libraries/nestjs-libraries/src/upload/upload.factory';

describe('native editor mode during worker recovery', () => {
  const keys = ['COOKED_EDITOR_ENABLED', 'COOKED_EDITOR_SOCKET', 'COOKED_EDITOR_ORGANIZATIONS'];
  let prior: (string | undefined)[];
  let service: CookedReviewService;
  beforeEach(() => {
    prior = keys.map(key => process.env[key]);
    Object.assign(process.env, { COOKED_EDITOR_ENABLED: 'true', COOKED_EDITOR_ORGANIZATIONS: 'org-a', COOKED_EDITOR_SOCKET: join(tmpdir(), 'missing-cooked-' + randomUUID() + '.sock') });
    jest.spyOn(UploadFactory, 'createStorage').mockReturnValue({} as any);
    service = new CookedReviewService({} as any, {} as any);
  });
  afterEach(() => { keys.forEach((key, i) => prior[i] === undefined ? delete process.env[key] : process.env[key] = prior[i]); jest.restoreAllMocks(); });
  it('keeps native mode when its configured socket is temporarily missing', async () => {
    expect(await service.status('org-a')).toEqual({ enabled: true, ready: false });
  });
  it('keeps disabled and foreign organizations in the legacy mode without probing', async () => {
    const client = jest.spyOn(service as any, 'client');
    expect(await service.status('org-b')).toEqual({ enabled: false, ready: false });
    process.env.COOKED_EDITOR_ENABLED = 'false';
    expect(await service.status('org-a')).toEqual({ enabled: false, ready: false });
    expect(client).not.toHaveBeenCalled();
  });
  it('reports readiness independently for an enabled organization', async () => {
    jest.spyOn(service as any, 'client').mockResolvedValue({ health: async () => ({ ready: true }) });
    expect(await service.status('org-a')).toEqual({ enabled: true, ready: true });
  });
});
