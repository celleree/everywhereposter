import { request } from 'http';
import { createReadStream, createWriteStream } from 'fs';
import { stat } from 'fs/promises';
import { Transform } from 'stream';
import { pipeline } from 'stream/promises';
import type { IncomingMessage } from 'http';
import { COOKED_EDITOR_LIMITS as LIMITS } from './cooked-editor-limits';

/** Fixed Unix-socket dispatch; never accepts a browser host, port or filesystem path. */
export class CookedWorkerClient {
  constructor(private readonly socket: string) {}
  private async call(path: string, method: string, org: string, media: string, body?: string, source?: string,
    extra: Record<string, string> = {}, timeout: number = LIMITS.requestTimeoutMs): Promise<IncomingMessage> {
    const size = source ? (await stat(source)).size : body ? Buffer.byteLength(body) : 0;
    if (size > 100 * 1024 * 1024) throw new Error('SOURCE_TOO_LARGE');
    return new Promise((resolve, reject) => {
      const req = request({ socketPath: this.socket, path, method, headers: { 'x-cooked-org': org, 'x-cooked-media': media, 'content-length': String(size), ...extra } }, res => {
        if ((res.statusCode || 500) >= 400) { res.resume(); reject(Object.assign(new Error('Worker request rejected'), { status: res.statusCode })); }
        else resolve(res);
      });
      req.setTimeout(timeout, () => req.destroy(new Error('Worker deadline exceeded'))); req.on('error', reject);
      if (source) {
        const stream = createReadStream(source); stream.on('error', e => req.destroy(e)); req.on('close', () => stream.destroy()); stream.pipe(req);
      } else req.end(body);
    });
  }
  async health() {
    const res = await this.call('/health', 'GET', 'health', 'health', undefined, undefined, {}, 2000);
    let text = ''; for await (const chunk of res) { text += chunk; if (text.length > 1024) { res.destroy(); throw new Error('WORKER_RESPONSE_LIMIT'); } }
    return JSON.parse(text);
  }
  async bytes(path: string, org: string, media: string, method = 'GET', body?: unknown) {
    const response = await this.call(path, method, org, media, body === undefined ? undefined : JSON.stringify(body));
    const chunks: Buffer[] = []; let size = 0;
    for await (const chunk of response) { size += chunk.length; if (size > 8 * 1024 * 1024) { response.destroy(); throw new Error('WORKER_RESPONSE_LIMIT'); } chunks.push(chunk); }
    return Buffer.concat(chunks);
  }
  async json(path: string, org: string, media: string, method = 'GET', body?: unknown) { return JSON.parse((await this.bytes(path, org, media, method, body)).toString()); }
  async create(org: string, media: string, requestId: string, path: string, metadata: unknown) {
    const response = await this.call('/jobs', 'POST', org, media, undefined, path,
      { 'x-cooked-request': requestId, 'x-cooked-metadata': Buffer.from(JSON.stringify(metadata)).toString('base64') });
    const chunks: Buffer[] = []; let size = 0;
    for await (const chunk of response) { size += chunk.length; if (size > LIMITS.receiptBytes) { response.destroy(); throw new Error('WORKER_RESPONSE_LIMIT'); } chunks.push(chunk); }
    return JSON.parse(Buffer.concat(chunks).toString());
  }
  async download(org: string, media: string, job: string, round: number, path: string) {
    const response = await this.call(`/jobs/${job}/download?k=cut-${round}`, 'GET', org, media);
    const length = Number(response.headers['content-length']);
    if (!Number.isSafeInteger(length) || length < 1 || length > 100 * 1024 * 1024) { response.destroy(); throw new Error('OUTPUT_TOO_LARGE'); }
    let size = 0;
    const bounded = new Transform({ transform(chunk, _, done) { size += chunk.length; done(size > length ? new Error('OUTPUT_TOO_LARGE') : null, chunk); } });
    await pipeline(response, bounded, createWriteStream(path, { flags: 'wx', mode: 0o600 }));
    if ((await stat(path)).size !== length) throw new Error('INCOMPLETE_OUTPUT');
  }
  async stream(path: string, org: string, media: string, range?: string) {
    const response = await this.call(path, 'GET', org, media, undefined, undefined, range ? { range } : {});
    const length = Number(response.headers['content-length']);
    const contentRange = response.headers['content-range'];
    const match = typeof contentRange === 'string' && /^bytes (\d+)-(\d+)\/(\d+)$/.exec(contentRange);
    const validRange = match && Number(match[1]) <= Number(match[2]) && Number(match[2]) < Number(match[3]) && Number(match[3]) <= 100 * 1024 * 1024 && Number(match[2]) - Number(match[1]) + 1 === length;
    if (![200, 206].includes(response.statusCode!) || !Number.isSafeInteger(length) || length < 1 || length > 100 * 1024 * 1024 || (response.statusCode === 206 ? !validRange : contentRange !== undefined)) { response.destroy(); throw new Error('INVALID_MEDIA_RESPONSE'); }
    return response;
  }
}
