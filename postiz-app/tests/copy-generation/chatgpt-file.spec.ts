jest.mock('bcrypt', () => ({ hashSync: jest.fn(), compareSync: jest.fn() }));
jest.mock('@mastra/core/tools', () => ({ createTool: (definition: unknown) => definition }));
jest.mock('node:https', () => ({ get: jest.fn() }));
jest.mock('node:dns/promises', () => ({ lookup: jest.fn() }));
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { get } from 'node:https';
import { lookup } from 'node:dns/promises';
import { chatgptFileInput, createChatGPTFileTool, downloadChatGPTFile, isPublicAddress, publicLookup, validateDownloadUrl } from '../../libraries/nestjs-libraries/src/chat/chatgpt-file';
import { runWithContext } from '../../libraries/nestjs-libraries/src/chat/async.storage';

const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489', 'hex');
const mp4 = Buffer.from('000000186674797069736f6d0000000069736f6d69736f32', 'hex');
const url = 'https://files.example.test/image?secret=signed-url';
const file = { download_url: url, file_id: 'file_test' };
const context = (fn: any, scopes = ['posts:write'], org = 'org') => runWithContext({ requestId: 'pos_test', auth: { id: org }, oauth: { id: 'grant', scopes } }, fn);

describe('ChatGPT file contract and ingestion', () => {
  let media: any, storage: any, download: any, tool: any;
  beforeEach(() => {
    media = { saveFile: jest.fn().mockResolvedValue({ id: 'media', path: 'https://app.test/uploads/id.png', token: 'omit' }) };
    storage = { uploadFile: jest.fn().mockResolvedValue({ originalname: 'id.png', path: 'https://app.test/uploads/id.png' }) };
    download = jest.fn().mockResolvedValue(png);
    tool = createChatGPTFileTool(media, download, () => storage);
  });
  it('declares all four fields but requires only download_url/file_id and fileParams', () => {
    expect(Object.keys(chatgptFileInput.shape.file.shape)).toEqual(['download_url', 'file_id', 'mime_type', 'file_name']);
    expect(chatgptFileInput.parse({ file })).toEqual({ file });
    expect(() => chatgptFileInput.parse({ file: { download_url: url } })).toThrow();
    expect(() => chatgptFileInput.parse({ file, organizationId: 'other' })).toThrow();
    expect(tool.mcp._meta['openai/fileParams']).toEqual(['file']);
    expect(tool.mcp.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false, openWorldHint: true });
  });
  it.each([[png, 'image/png'], [mp4, 'video/mp4']])('persists recognized media through existing storage and tenant media service', async (buffer, mime) => {
    download.mockResolvedValue(buffer);
    const result = await context(() => tool.execute({ file: { ...file, mime_type: mime, file_name: '../../evil\nname.png' } }));
    expect(result).toEqual({ mediaId: 'media', url: 'https://app.test/uploads/id.png', mimeType: mime });
    const upload = storage.uploadFile.mock.calls[0][0];
    expect(upload.originalname).not.toMatch(/[\/\\\n]/);
    expect(media.saveFile).toHaveBeenCalledWith('org', 'id.png', 'https://app.test/uploads/id.png', upload.originalname, mime);
    expect(JSON.stringify(result)).not.toMatch(/secret|file_test|download_url|token/);
  });
  it('rejects accounts:read before fetching or storing', async () => {
    await expect(context(() => tool.execute({ file }), ['accounts:read'])).rejects.toThrow('scope');
    expect(download).not.toHaveBeenCalled(); expect(storage.uploadFile).not.toHaveBeenCalled();
  });
  it.each([Buffer.from('<svg><script>evil</script></svg>'), Buffer.concat([png, Buffer.alloc(10 * 1024 * 1024)])])('rejects unsupported or oversized images', async (buffer) => {
    download.mockResolvedValue(buffer);
    await expect(context(() => tool.execute({ file }))).rejects.toThrow('Unable to import');
    expect(storage.uploadFile).not.toHaveBeenCalled();
  });
  it('rejects false MIME claims and hides downloader/storage errors', async () => {
    await expect(context(() => tool.execute({ file: { ...file, mime_type: 'text/html' } }))).rejects.toThrow('Unable to import');
    download.mockRejectedValue(new Error(url));
    const log = jest.spyOn(console, 'error').mockImplementation(() => {});
    await expect(context(() => tool.execute({ file }))).rejects.toThrow(/^Unable to import file\. Check/);
    expect(log).not.toHaveBeenCalled(); log.mockRestore();
  });
  it('bounds concurrent imports per organization and process, and releases on failure', async () => {
    let release: any; download.mockReturnValue(new Promise((resolve) => { release = resolve; }));
    const first = context(() => tool.execute({ file }));
    await expect(context(() => tool.execute({ file }))).rejects.toThrow('busy');
    const second = context(() => tool.execute({ file }), ['posts:write'], 'org2');
    await expect(context(() => tool.execute({ file }), ['posts:write'], 'org3')).rejects.toThrow('busy');
    release(png); await Promise.all([first, second]);
    download.mockResolvedValue(png);
    await expect(context(() => tool.execute({ file }))).resolves.toHaveProperty('mediaId');
  });
});

describe('bounded public HTTPS download', () => {
  beforeEach(() => jest.clearAllMocks());
  afterEach(() => jest.useRealTimers());
  it.each(['http://public.test/a', 'https://localhost/a', 'https://127.0.0.1/a', 'https://[::1]/a', 'https://2130706433/a', 'https://0x7f000001/a', 'https://public.test:8443/a', 'https://u:p@public.test/a'])('rejects unsafe URL %s', (value) => {
    expect(() => validateDownloadUrl(value)).toThrow();
  });
  it.each(['0.0.0.1', '10.0.0.1', '127.0.0.1', '168.63.129.16', '169.254.169.254', '172.31.0.1', '192.168.1.1', '100.100.100.200', '192.0.0.8', '198.18.0.1', '224.0.0.1', '255.255.255.255', '::1', '::ffff:127.0.0.1', 'fc00::1', 'fe80::1', '2002:7f00:1::', '2001:db8::1', '64:ff9b::7f00:1'])('rejects nonpublic address %s', (address) => expect(isPublicAddress(address)).toBe(false));
  it.each(['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111', '2001:4860:4860::8888'])('allows global address %s', (address) => expect(isPublicAddress(address)).toBe(true));
  it('rejects mixed public/private DNS and pins checked public answers to the socket', async () => {
    const callback = jest.fn();
    (lookup as jest.Mock).mockResolvedValue([{ address: '8.8.8.8', family: 4 }, { address: '10.0.0.1', family: 4 }]);
    publicLookup('public.test', {}, callback); await Promise.resolve();
    expect(callback).toHaveBeenCalledWith(expect.any(Error));
    callback.mockClear();
    (lookup as jest.Mock).mockResolvedValue([{ address: '8.8.8.8', family: 4 }]);
    publicLookup('public.test', { all: true }, callback); await Promise.resolve();
    expect(callback).toHaveBeenCalledWith(null, [{ address: '8.8.8.8', family: 4 }]);
  });
  function respond(chunks: Buffer[], statusCode = 200, headers = {}) {
    const request = Object.assign(new EventEmitter(), { destroy: jest.fn() });
    (get as jest.Mock).mockImplementation((_url, options, callback) => {
      expect(options.lookup).toBe(publicLookup); expect(options.agent).toBe(false);
      options.signal.addEventListener('abort', () => request.emit('error', new Error(url)));
      setImmediate(() => callback(Object.assign(Readable.from(chunks), { statusCode, headers })));
      return request;
    });
    return request;
  }
  it('downloads a bounded file without forwarding any credentials', async () => {
    respond([png]); await expect(downloadChatGPTFile(url)).resolves.toEqual(png);
    expect((get as jest.Mock).mock.calls[0][1].headers.Authorization).toBeUndefined();
  });
  it.each([302, 307, 404])('rejects response %s without following redirects', async (status) => {
    const req = respond([], status, { location: 'http://169.254.169.254/latest/meta-data/' });
    await expect(downloadChatGPTFile(url)).rejects.toThrow('Unable to download');
    expect(get).toHaveBeenCalledTimes(1); expect(req.destroy).toHaveBeenCalled();
  });
  it('bounds declared and streamed bytes', async () => {
    respond([], 200, { 'content-length': String(65 * 1024 * 1024) });
    await expect(downloadChatGPTFile(url)).rejects.toThrow('Unable to download');
    respond([Buffer.alloc(64 * 1024 * 1024), Buffer.from('x')]);
    await expect(downloadChatGPTFile(url)).rejects.toThrow('Unable to download');
  });
  it('uses an overall deadline and never returns sensitive network errors', async () => {
    jest.useFakeTimers();
    const request = Object.assign(new EventEmitter(), { destroy: jest.fn() });
    (get as jest.Mock).mockImplementation((_url, { signal }) => {
      signal.addEventListener('abort', () => request.emit('error', new Error(url))); return request;
    });
    const result = expect(downloadChatGPTFile(url)).rejects.toThrow(/^Unable to download file:/);
    await jest.advanceTimersByTimeAsync(60_000); await result;
  });
});
