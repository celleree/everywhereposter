// Pure request validation: no generated engine, database or external requests.
jest.mock('@prisma/client', () => ({ Prisma: { DbNull: null }, PrismaClient: class {} }));
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import { normalizeStudioRequest } from '../../libraries/nestjs-libraries/src/media-editing/studio-edit.repository';
import { studioAcceptedFonts, studioAcceptedTitle } from '../../libraries/nestjs-libraries/src/media-editing/studio-title-plan';
import { StudioEditService } from '../../libraries/nestjs-libraries/src/media-editing/studio-edit.service';
import { UploadFactory } from '../../libraries/nestjs-libraries/src/upload/upload.factory';
import { studioDirectory } from '../../libraries/nestjs-libraries/src/media-editing/studio-worker';
import { mkdtemp, mkdir, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

const original = () => ({ requestKey: randomUUID(), sourceMediaId: 'source', brollMediaIds: [], destinations: ['instagram'], profile: 'talking-head-v2' as const,
  creative: { brief: 'Keep my source.', framing: { x: .2, y: .3, width: .4, height: .2, confirmed: true as const, stationary: true as const, singleSpeaker: true as const } } });
it('preserves legacy request identity and binds the optional revision/style controls', () => {
  const legacy = original(); assert.deepEqual(normalizeStudioRequest(legacy), legacy);
  const body = { ...legacy, sourceEvidenceJobId: randomUUID(), creative: { ...legacy.creative, editorStyle: 'accepted-caption-b-top-rounded-v1' as const, headline: '  My headline  ', restoreCuts: true } };
  const accepted = normalizeStudioRequest(body);
  assert.equal(accepted.sourceEvidenceJobId, body.sourceEvidenceJobId); assert.equal(accepted.creative!.headline, 'My headline');
  assert.equal(accepted.creative!.restoreCuts, true);
  for (const change of [{ sourceEvidenceJobId: 'foreign/path' }, { profile: 'easy-graphics-v1' }, { destinations: ['youtube'] },
    { creative: { ...body.creative, editorStyle: 'unknown' } }, { creative: { ...body.creative, headline: 'First\nSecond' } },
    { creative: { ...body.creative, headline: '' } }, { creative: { ...body.creative, restoreCuts: 'yes' } }]) assert.throws(() => normalizeStudioRequest({ ...body, ...change } as any));
  assert.throws(() => normalizeStudioRequest({ ...legacy, sourceEvidenceJobId: randomUUID() }));
});
it('rejects a different installed font instead of silently substituting it', async () => {
  const root = await mkdtemp(join(tmpdir(), 'studio-approved-font-'));
  try {
    await mkdir(join(root, 'fonts'));
    await writeFile(join(root, 'fonts/LiberationSans-Bold.ttf'), 'wrong licensed font variant');
    await writeFile(join(root, 'fonts/TikTokSans36pt-Bold.ttf'), 'wrong face');
    await assert.rejects(studioAcceptedFonts({ root } as any), /exact approved licensed fonts/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
it('marks an unusable opening headline as a text adjustment instead of rewriting it', () => {
  assert.throws(() => studioAcceptedTitle({ words: [{ id: 'w0', text: 'Unfinished', start: 0, end: 1 }], frames: 30 } as any),
    (error: any) => error.studioTextLayout === true);
});
it.each([false, true])('keeps text-layout adjustment guidance safe and specific to the approved editor: approved=%s', async approved => {
  const root = await mkdtemp(join(tmpdir(), 'studio-approved-adjustment-'));
  const storage = jest.spyOn(UploadFactory, 'createStorage').mockReturnValue({} as any);
  try {
    const request = original();
    const row = { id: randomUUID(), generation: 1, state: 'RUNNING', sourceMediaId: 'source', input: { request: { ...request, creative: { ...request.creative, ...(approved ? { editorStyle: 'accepted-caption-b-top-rounded-v1' } : {}) } }, media: [{ id: 'source', path: '/source.mp4' }] } };
    const config = { work: root } as any, dir = studioDirectory(config, row);
    await mkdir(dir, { recursive: true });
    const service = new StudioEditService({ get: async () => row } as any, { media: { findMany: async () => row.input.media } } as any);
    (service as any).runtime = async () => config;
    (service as any).produce = jest.fn().mockRejectedValue(Object.assign(new Error('private transcript /private/source.mp4'), { studioTextLayout: true }));
    (service as any).startProducer('owner', row);
    await Promise.all((service as any).running.values());
    const result: any = await service.status('owner', row.id);
    assert.equal(result.phase, approved ? 'NEEDS_TEXT_ADJUSTMENT' : 'NEEDS_VERIFICATION');
    assert.equal(result.technicalStatus, 'NOT_VERIFIED');
    if (approved) {
      assert.match(result.message, /shorter headline/i);
      assert.match(result.message, /previous verified result/);
      assert.match(result.message, /Start another edit/);
    }
    assert.doesNotMatch(JSON.stringify(result), /private transcript|\/private\/source/);
  } finally { storage.mockRestore(); await rm(root, { recursive: true, force: true }); }
});
