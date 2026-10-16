import { VideoEditClient, editReceipt, mediaUrl, downloadVideo } from '../../apps/frontend/src/components/video-editor/video-editor.client';
import { buildVideoEditDecisionList } from '../../libraries/nestjs-libraries/src/media-editing/video-edit-decision';

const source = { id: 'source', path: '/source.mp4', type: 'video' };
const output = { id: 'output', path: '/edited.mp4', type: 'video' };
const result = () => ({ schemaVersion: 1, outputMedia: output,
  editDecisionList: buildVideoEditDecisionList({ mediaId: source.id, durationMs: 2500, pacingPreset: 'relaxed', detectedSilence: [] }),
  render: { status: 'completed', durationMs: 2500, container: 'mp4', videoCodec: 'h264', audioCodec: 'aac' } });
const reply = (body: any, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response;
function fixture() {
  const changed = jest.fn();
  const fetch = jest.fn(async (_url: string, options?: RequestInit) => reply(options?.method === 'POST' ? result() : output, options?.method === 'POST' ? 201 : 200));
  return { changed, fetch, client: new VideoEditClient(fetch, localStorage, 'user:org', changed) };
}
beforeEach(() => {
  localStorage.clear();
  Object.defineProperty(navigator, 'locks', { configurable: true, value: { request: jest.fn(async (_key, options, work) => {
    expect(options).toEqual({ ifAvailable: true }); return work({});
  }) } });
});
it('saves a receipt before POST, verifies owned output and restores without repeating work', async () => {
  const f = fixture();
  f.fetch.mockImplementation(async (_url, options) => {
    if (options?.method === 'POST') expect(JSON.parse(localStorage.getItem(localStorage.key(0)!)!).status).toBe('pending');
    return reply(options?.method === 'POST' ? result() : output, options?.method === 'POST' ? 201 : 200);
  });
  await f.client.edit(source, 'relaxed'); await f.client.edit(source, 'relaxed');
  expect(f.changed.mock.calls.at(-1)[0]).toMatchObject({ status: 'complete', output });
  expect(f.fetch.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(1);
  const returned = new VideoEditClient(f.fetch, localStorage, 'user:org', f.changed);
  await returned.edit(source, 'relaxed');
  expect(f.fetch.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(1);
});
it.each([500, 503, 408])('keeps HTTP%s uncertain and never automatically retries it', async status => {
  const f = fixture(); f.fetch.mockResolvedValue(reply({}, status));
  await f.client.edit(source, 'relaxed'); await f.client.edit(source, 'relaxed');
  expect(f.changed.mock.calls.at(-1)[0].status).toBe('unknown'); expect(f.fetch).toHaveBeenCalledTimes(1);
});
it.each([400, 401, 403, 404, 422, 429])('requires a deliberate retry after a known HTTP%s rejection', async status => {
  const f = fixture(); f.fetch.mockResolvedValue(reply({ message: 'Known rejection' }, status));
  await f.client.edit(source, 'relaxed'); await f.client.edit(source, 'relaxed');
  expect(f.changed.mock.calls.at(-1)[0].status).toBe('rejected'); expect(f.fetch).toHaveBeenCalledTimes(1);
  await f.client.edit(source, 'relaxed', true); expect(f.fetch).toHaveBeenCalledTimes(2);
});
it('stops waiting safely, blocks concurrent submissions and preserves uncertainty after return', async () => {
  const f = fixture(); let started!: () => void; const pending = new Promise<void>(resolve => { started = resolve; });
  f.fetch.mockImplementation(async (_url, options) => {
    started(); await new Promise((_, reject) => options!.signal!.addEventListener('abort', () => reject(new Error('Disconnected'))));
    return reply(result());
  });
  const run = f.client.edit(source, 'relaxed'); await pending;
  await f.client.edit(source, 'tight'); expect(f.fetch).toHaveBeenCalledTimes(1);
  f.client.stop(); await run; expect(f.changed.mock.calls.at(-1)[0].status).toBe('unknown');
  await new VideoEditClient(f.fetch, localStorage, 'user:org', f.changed).edit(source, 'relaxed');
  expect(f.fetch).toHaveBeenCalledTimes(1);
});
it('fails closed before rendering when recovery storage is unavailable', async () => {
  const f = fixture(); const storage = { getItem: () => null, setItem: () => { throw new Error('Quota'); } } as unknown as Storage;
  await new VideoEditClient(f.fetch, storage, 'user:org', f.changed).edit(source, 'relaxed');
  expect(f.fetch).not.toHaveBeenCalled(); expect(f.changed.mock.calls.at(-1)[0]).toMatchObject({ status: 'rejected', message: 'Browser recovery could not be saved. No edit was started.' });
});
it('does not submit when another tab owns the browser lock', async () => {
  (navigator.locks.request as jest.Mock).mockImplementation(async (_key, _options, work) => work(null));
  const f = fixture(); await f.client.edit(source, 'relaxed');
  expect(f.fetch).not.toHaveBeenCalled(); expect(f.changed.mock.calls.at(-1)[0].status).toBe('unknown');
});
it('retains a confirmed output receipt when verification fails and uses GET only on recovery', async () => {
  const f = fixture(); f.fetch.mockImplementation(async (_url, options) => options?.method === 'POST' ? reply(result(), 201) : reply({}, 404));
  await f.client.edit(source, 'relaxed'); expect(f.changed.mock.calls.at(-1)[0].status).toBe('unknown');
  f.fetch.mockImplementation(async () => reply(output)); await f.client.edit(source, 'relaxed');
  expect(f.changed.mock.calls.at(-1)[0]).toMatchObject({ status: 'complete', output });
  expect(f.fetch.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(1);
});
it.each(['version', 'source', 'pacing', 'identity', 'address', 'codec'])('rejects a mismatched %s result', field => {
  const body = result();
  if (field === 'version') body.schemaVersion = 2;
  if (field === 'source') body.editDecisionList.source.mediaId = 'foreign';
  if (field === 'pacing') body.editDecisionList.pacingPreset = 'tight';
  if (field === 'identity') body.outputMedia = { ...output, id: source.id };
  if (field === 'address') body.outputMedia = { ...output, path: 'javascript:alert(1)' };
  if (field === 'codec') body.render.videoCodec = 'unsupported';
  expect(() => editReceipt(body, source.id, 'relaxed')).toThrow();
});
it('rejects credential-bearing media URLs', () => expect(() => mediaUrl('https://user:password@example.test/video.mp4')).toThrow());

it('downloads with no application credentials and enforces the byte ceiling while streaming', async () => {
  const original = window.fetch;
  const cancel = jest.fn();
  window.fetch = jest.fn(async () => ({ ok: true, headers: { get: () => null }, body: { getReader: () => ({
    read: jest.fn().mockResolvedValue({ done: false, value: { byteLength: 100 * 1024 * 1024 + 1 } }), cancel,
  }) } })) as any;
  try {
    await expect(downloadVideo({ ...output, path: 'https://storage.example.test/edited.mp4' }, new AbortController().signal)).rejects.toThrow('exceeds');
    expect(window.fetch).toHaveBeenCalledWith('https://storage.example.test/edited.mp4', expect.objectContaining({ credentials: 'omit', redirect: 'error' }));
    expect((window.fetch as jest.Mock).mock.calls[0][1].headers).toBeUndefined();
    expect(cancel).toHaveBeenCalled();
  } finally { window.fetch = original; }
});
it('fails closed on corrupt saved receipts and ignores another user scope', async () => {
  const f = fixture();
  localStorage.setItem('everywhereposter:video-edit:v1:user:org:source:relaxed', '{invalid');
  await f.client.edit(source, 'relaxed'); expect(f.fetch).not.toHaveBeenCalled();
  expect(f.changed.mock.calls.at(-1)[0].status).toBe('unknown');
  await new VideoEditClient(f.fetch, localStorage, 'another:org', f.changed).edit(source, 'relaxed');
  expect(f.fetch.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(1);
});
