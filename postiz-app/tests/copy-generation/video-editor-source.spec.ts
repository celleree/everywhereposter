import axios from 'axios';
import { mkdtemp, mkdir, rm, writeFile, symlink, stat } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { Readable } from 'stream';
import { prepareEditorSource } from '../../libraries/nestjs-libraries/src/media-editing/video-editor-source';
jest.mock('axios', () => jest.fn());
describe('editor source trust boundary', () => {
  let directory: string;
  let old: NodeJS.ProcessEnv;
  beforeEach(async () => {
    old = { ...process.env }; directory = await mkdtemp(join(tmpdir(), 'editor-source-test-'));
    process.env.STORAGE_PROVIDER = 'local'; process.env.FRONTEND_URL = 'https://app.example'; process.env.UPLOAD_DIRECTORY = join(directory, 'uploads');
    await mkdir(process.env.UPLOAD_DIRECTORY); await writeFile(join(process.env.UPLOAD_DIRECTORY, 'source.mp4'), 'source');
  });
  afterEach(async () => { process.env = old; await rm(directory, { recursive: true, force: true }); });
  it('resolves local uploads without network and preserves them on cleanup', async () => {
    const file = await prepareEditorSource('https://app.example/uploads/source.mp4');
    expect(file.isTemporary).toBe(false); await file.cleanup();
    expect(await stat(file.inputPath)).toBeDefined(); expect(axios).not.toHaveBeenCalled();
  });
  it.each(['https://evil.example/uploads/source.mp4', 'https://user:pass@app.example/uploads/source.mp4', 'https://app.example/uploads/%2e%2e%2foutside.mp4', '/etc/passwd'])('rejects untrusted local source %s', async (path) => {
    await expect(prepareEditorSource(path)).rejects.toThrow(); expect(axios).not.toHaveBeenCalled();
  });
  it('rejects an upload symlink escaping the configured root', async () => {
    await writeFile(join(directory, 'outside.mp4'), 'outside');
    await symlink(join(directory, 'outside.mp4'), join(process.env.UPLOAD_DIRECTORY!, 'escape.mp4'));
    await expect(prepareEditorSource('https://app.example/uploads/escape.mp4')).rejects.toThrow();
  });
  it('uses the configured R2 prefix, byte bound, deadline and no redirects', async () => {
    process.env.STORAGE_PROVIDER = 'cloudflare'; process.env.CLOUDFLARE_BUCKET_URL = 'https://media.example/bucket';
    (axios as unknown as jest.Mock).mockResolvedValue({ data: Readable.from(Buffer.from('source')), headers: {} });
    const file = await prepareEditorSource('https://media.example/bucket/source.mp4');
    expect(axios).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://media.example/bucket/source.mp4', maxRedirects: 0, maxContentLength: 100 * 1024 * 1024, signal: expect.any(AbortSignal) }));
    await file.cleanup(); await expect(stat(file.inputPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it.each(['https://media.example/other/source.mp4', 'http://media.example/bucket/source.mp4', 'https://media.example.evil/bucket/source.mp4', 'https://user@media.example/bucket/source.mp4'])('rejects untrusted R2 source %s', async (path) => {
    process.env.STORAGE_PROVIDER = 'cloudflare'; process.env.CLOUDFLARE_BUCKET_URL = 'https://media.example/bucket';
    await expect(prepareEditorSource(path)).rejects.toThrow(); expect(axios).not.toHaveBeenCalled();
  });
});
