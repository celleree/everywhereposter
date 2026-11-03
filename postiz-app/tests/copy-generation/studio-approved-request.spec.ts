// Pure request validation: no generated engine, database or external requests.
jest.mock('@prisma/client', () => ({ Prisma: { DbNull: null }, PrismaClient: class {} }));
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import { normalizeStudioRequest } from '../../libraries/nestjs-libraries/src/media-editing/studio-edit.repository';
import { studioAcceptedFonts } from '../../libraries/nestjs-libraries/src/media-editing/studio-title-plan';
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
