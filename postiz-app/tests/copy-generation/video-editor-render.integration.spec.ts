import { execFile } from 'child_process';
import { promisify } from 'util';
import { mkdtemp, rm, stat, readFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { VideoEditorService } from '../../libraries/nestjs-libraries/src/media-editing/video-editor.service';
import { FfmpegVideoEditorService } from '../../libraries/nestjs-libraries/src/media-editing/ffmpeg-video-editor.service';
describe('real local Video Editor service', () => {
  jest.setTimeout(60_000);
  let directory: string;
  let source: string;
  const oldEnvironment = { ...process.env };
  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'editor-service-render-')); source = join(directory, 'source.mp4');
    await promisify(execFile)('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=size=160x120:duration=4', '-f', 'lavfi', '-i', 'sine=duration=4', '-filter:a', "volume=0:enable='between(t,1,3)'", '-c:v', 'libx264', '-threads', '2', '-c:a', 'aac', '-shortest', source]);
    process.env.FRONTEND_URL = 'https://app.example'; process.env.STORAGE_PROVIDER = 'local'; process.env.UPLOAD_DIRECTORY = directory;
  });
  afterAll(async () => { process.env = oldEnvironment; await rm(directory, { recursive: true, force: true }); });
  it('executes the complete local service/render/storage path with scoped repository fixtures', async () => {
    const before = await readFile(source);
    const media = { getMediaByOrganizationIdAndId: jest.fn().mockResolvedValue({ id: 'source', type: 'video', path: source, name: 'source.mp4' }),
      saveFile: jest.fn(async (org: string, name: string, path: string) => ({ id: 'output', organizationId: org, name, path, type: 'video' })) };
    const transcripts = { getCurrentForActiveMedia: jest.fn().mockResolvedValue(null) };
    const result = await new VideoEditorService(media as any, transcripts as any, new FfmpegVideoEditorService()).create('org-fixture', 'source', { schemaVersion: 1, pacingPreset: 'tight' });
    expect(result.outputMedia).toMatchObject({ id: 'output', organizationId: 'org-fixture', type: 'video' });
    expect(result.render.durationMs).toBeLessThan(3200);
    expect(result.editDecisionList.decisions.some((d) => d.action === 'cut')).toBe(true);
    expect(await stat(join(directory, new URL(result.outputMedia.path).pathname.replace(/^\/uploads\//, '')))).toBeDefined();
    expect(await readFile(source)).toEqual(before);
  });
});
