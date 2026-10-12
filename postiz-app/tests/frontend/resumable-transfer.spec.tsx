import { File as NodeFile } from 'buffer';
import { webcrypto } from 'crypto';
import { waitFor } from '@testing-library/react';
import { ResumableTransfers, fileManifest, CHUNK_BYTES } from '../../apps/frontend/src/components/media/resumable-transfer';

Object.defineProperty(globalThis, 'crypto', { value: webcrypto });
const file = (size = CHUNK_BYTES + 4, tail = 1) => {
  const data = Buffer.alloc(size); data[size - 1] = tail;
  return new NodeFile([data], 'video.mp4', { type: 'video/mp4' }) as unknown as File;
};
function fixture() {
  let session: any, failPart = -1, loseComplete = false;
  const changed = jest.fn();
  const requests: any[] = [];
  const fetch = jest.fn(async (url: string, options?: RequestInit) => {
    requests.push({ url, options });
    if (options?.method === 'POST' && url === '/media/uploads') {
      const body = JSON.parse(String(options.body)); session = { ...body, id: 'server-session', parts: [], status: 'UPLOADING' };
    } else if (url.endsWith('/complete')) {
      session = { ...session, status: 'COMPLETE', media: { id: 'saved-media' } };
      if (loseComplete) { loseComplete = false; throw new Error('lost acknowledgement'); }
    } else if (url.includes('/parts/')) {
      const index = Number(url.split('/').pop());
      if (index === failPart) { failPart = -1; throw new Error('connection interrupted'); }
      session.parts.push({ index, digest: session.manifest[index], byteSize: (options?.body as Blob).size });
    } else if (url === '/media/uploads') return { ok: true, json: async () => ({ sessions: session ? [session] : [] }) } as Response;
    return { ok: true, json: async () => JSON.parse(JSON.stringify(session)) } as Response;
  });
  const transfers = new ResumableTransfers(fetch, changed, 'org');
  return { transfers, changed, requests, getSession: () => session, fail: (index: number) => { failPart = index; }, lose: () => { loseComplete = true; } };
}
const current = (f: ReturnType<typeof fixture>) => f.changed.mock.calls.at(-1)?.[0][0];
it('uses bounded slices and reports completion only with a server media receipt', async () => {
  const f = fixture(); const receipt = f.transfers.start(file());
  expect(current(f).state).toBe('Uploading');
  expect(await receipt).toEqual({ id: 'saved-media' });
  const parts = f.requests.filter(request => request.url.includes('/parts/'));
  expect(parts).toHaveLength(2); expect(parts.every(part => part.options.body.size <= CHUNK_BYTES)).toBe(true);
  expect(current(f).state).toBe('Transfer complete');
});
it('resumes acknowledged parts after interruption without a second session', async () => {
  const f = fixture(); f.fail(1); const original = file(); const receipt = f.transfers.start(original);
  await waitFor(() => expect(current(f).state).toBe('Resume needed'));
  expect(current(f).sent).toBe(CHUNK_BYTES);
  await f.transfers.resume(current(f).id, original); await receipt;
  expect(f.requests.filter(request => request.options?.method === 'POST' && request.url === '/media/uploads')).toHaveLength(1);
  expect(f.requests.filter(request => request.url.endsWith('/parts/0'))).toHaveLength(1);
});
it('rejects same metadata and uploaded prefix with a different tail', async () => {
  const f = fixture(); f.fail(1); f.transfers.start(file());
  await waitFor(() => expect(current(f).state).toBe('Resume needed'));
  const before = f.requests.filter(request => request.url.includes('/parts/')).length;
  await f.transfers.resume(current(f).id, file(CHUNK_BYTES + 4, 2));
  expect(current(f).error).toContain('not the original');
  expect(f.requests.filter(request => request.url.includes('/parts/'))).toHaveLength(before);
});
it('rediscovers server sessions after browser termination and requires the original file', async () => {
  const f = fixture(); f.fail(1); f.transfers.start(file()); await waitFor(() => expect(current(f).state).toBe('Resume needed'));
  f.transfers.dispose();
  const returned = new ResumableTransfers((f.transfers as any).fetch, f.changed, 'org'); await returned.refresh();
  expect(current(f).state).toBe('Resume needed');
  await expect(returned.resume('server-session')).rejects.toThrow('original video');
  await returned.resume('server-session', file()); expect(current(f).state).toBe('Transfer complete');
});
it('reconciles a lost completion acknowledgement without repeating transfer or creating media', async () => {
  const f = fixture(); f.lose(); const original = file(); const receipt = f.transfers.start(original);
  await waitFor(() => expect(current(f).state).toBe('Resume needed'));
  expect(f.getSession().status).toBe('COMPLETE');
  const requests = f.requests.length; await f.transfers.resume(current(f).id, original); await receipt;
  expect(f.requests.slice(requests).map(request => request.options?.method)).toEqual([undefined]);
});
it('pauses during hashing and retains a layout-owned file for explicit resume', async () => {
  const f = fixture(); f.transfers.start(file()); const id = current(f).id;
  f.transfers.pause(id); await waitFor(() => expect(current(f).state).toBe('Paused'));
  await waitFor(() => expect((f.transfers as any).controllers.size).toBe(0));
  expect(f.requests).toHaveLength(0);
  await f.transfers.resume(id); expect(current(f).state).toBe('Transfer complete');
});

it('cancellation during hashing never resurrects a transfer or sends a session', async () => {
  const f = fixture(); const receipt = f.transfers.start(file());
  const rejected = expect(receipt).rejects.toThrow('cancelled');
  const id = current(f).id; await f.transfers.cancel(id); await rejected;
  await waitFor(() => expect((f.transfers as any).controllers.size).toBe(0));
  expect(f.changed.mock.calls.at(-1)[0]).toEqual([]); expect(f.requests).toEqual([]);
});

it.each([false, true])('reconciles cancellation after creation starts without its acknowledgement (commit delayed: %s)', async delayed => {
  let session: any;
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const changed = jest.fn();
  const fetch = jest.fn(async (url: string, options?: RequestInit) => {
    if (options?.method === 'POST') {
      const saved = { ...JSON.parse(String(options.body)), id: 'pending-session', parts: [], status: 'UPLOADING' };
      if (!delayed) session = saved;
      await held;
      if (delayed) { session = saved; throw new Error('lost creation acknowledgement'); }
      return { ok: true, json: async () => saved } as Response;
    }
    if (options?.method === 'DELETE') session.status = 'CANCELLED';
    return { ok: true, json: async () => url === '/media/uploads' ? { sessions: session?.status === 'UPLOADING' ? [session] : [] } : session } as Response;
  });
  const transfers = new ResumableTransfers(fetch, changed, 'org');
  const receipt = transfers.start(file(4));
  const rejected = expect(receipt).rejects.toThrow('cancelled');
  await waitFor(() => expect(fetch.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(true));
  const id = changed.mock.calls[0][0][0].id;
  if (delayed) {
    await expect(transfers.cancel(id)).rejects.toThrow('uncertain');
    expect(changed.mock.calls.at(-1)[0]).toHaveLength(1);
    expect((transfers as any).files.has(id)).toBe(true);
  } else await transfers.cancel(id);
  release();
  await waitFor(() => expect((transfers as any).controllers.size).toBe(0));
  if (delayed) await transfers.cancel(id);
  await rejected;
  await transfers.refresh();
  expect(session.status).toBe('CANCELLED');
  expect(fetch.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(1);
  expect(fetch.mock.calls.filter(([, options]) => options?.method === 'DELETE').map(([url]) => url)).toEqual(['/media/uploads/pending-session']);
  expect(changed.mock.calls.at(-1)[0]).toEqual([]);
});
