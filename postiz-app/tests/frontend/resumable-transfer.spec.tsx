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
beforeEach(() => localStorage.clear());
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
  expect(f.transfers.hasFile(current(f).id)).toBe(true);
  await Promise.all([f.transfers.resume(current(f).id), f.transfers.resume(current(f).id, file(CHUNK_BYTES + 4, 2))]); await receipt;
  expect(f.requests.filter(request => request.options?.method === 'POST' && request.url === '/media/uploads')).toHaveLength(1);
  expect(f.requests.filter(request => request.url.endsWith('/parts/0'))).toHaveLength(1);
  expect(f.requests.filter(request => request.url.endsWith('/parts/1'))).toHaveLength(2);
  expect(f.transfers.hasFile(current(f).id)).toBe(false);
});
it('rejects same metadata and uploaded prefix with a different tail', async () => {
  const f = fixture(); f.fail(1); f.transfers.start(file());
  await waitFor(() => expect(current(f).state).toBe('Resume needed'));
  const before = f.requests.filter(request => request.url.includes('/parts/')).length;
  await f.transfers.resume(current(f).id, file(CHUNK_BYTES + 4, 2));
  expect(current(f).error).toContain('not the original');
  expect(f.requests.filter(request => request.url.includes('/parts/'))).toHaveLength(before);
  expect(f.transfers.hasFile(current(f).id)).toBe(false);
  await expect(f.transfers.resume(current(f).id)).rejects.toThrow('original video');
  await f.transfers.resume(current(f).id, file());
  expect(current(f).state).toBe('Transfer complete');
});
it('rediscovers server sessions after browser termination and requires the original file', async () => {
  const f = fixture(); f.fail(1); f.transfers.start(file()); await waitFor(() => expect(current(f).state).toBe('Resume needed'));
  f.transfers.dispose();
  const returned = new ResumableTransfers((f.transfers as any).fetch, f.changed, 'org'); await returned.refresh();
  expect(current(f).state).toBe('Resume needed');
  expect(returned.hasFile('server-session')).toBe(false);
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
  const cancelled = transfers.cancel(id);
  const duplicate = transfers.cancel(id);
  expect(duplicate).toBe(cancelled);
  release();
  await cancelled;
  await rejected;
  await transfers.refresh();
  expect(session.status).toBe('CANCELLED');
  expect(fetch.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(1);
  expect(fetch.mock.calls.filter(([, options]) => options?.method === 'DELETE').map(([url]) => url)).toEqual(['/media/uploads/pending-session']);
  expect(changed.mock.calls.at(-1)[0]).toEqual([]);
});

it('discards a definitively rejected new session without claiming server uncertainty', async () => {
  const changed = jest.fn();
  const fetch = jest.fn().mockResolvedValue({ ok: false, status: 409, json: async () => ({ message: 'Upload limit reached.' }) });
  const transfers = new ResumableTransfers(fetch, changed, 'org');
  const receipt = transfers.start(file(4));
  const rejected = expect(receipt).rejects.toThrow('cancelled');
  await waitFor(() => expect(changed.mock.calls.at(-1)[0][0].state).toBe('Resume needed'));
  await transfers.cancel(changed.mock.calls[0][0][0].id);
  await rejected;
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(changed.mock.calls.at(-1)[0]).toEqual([]);
  expect((transfers as any).files.size).toBe(0);
});

it('queues explicit Quick Upload during hashing and persists it before transferring parts', async () => {
  let session: any, quick: any;
  const events: string[] = [], changed = jest.fn();
  const fetch = jest.fn(async (url: string, options?: RequestInit) => {
    events.push(url);
    if (url.endsWith('/quick-upload')) { quick = { id: 'intent', status: 'WAITING', results: [] }; session.quickIntent = quick; return { ok: true, json: async () => quick } as Response; }
    if (url === '/media/uploads' && options?.method === 'POST') session = { ...JSON.parse(String(options.body)), id: 'session', parts: [], status: 'UPLOADING' };
    if (url.includes('/parts/')) session.parts.push({ index: Number(url.split('/').pop()), byteSize: (options!.body as Blob).size });
    if (url.endsWith('/complete')) session = { ...session, status: 'COMPLETE', media: { id: 'media' } };
    return { ok: true, json: async () => JSON.parse(JSON.stringify(session)) } as Response;
  });
  const transfers = new ResumableTransfers(fetch, changed, 'org'); const receipt = transfers.start(file());
  const id = changed.mock.calls.at(-1)![0][0].id;
  await transfers.optIntoQuickUpload(id, { confirmNoIndividualReview: true, destinations: [{ id: 'x', settings: { who_can_reply_post: 'everyone' } }] });
  await receipt;
  expect(events.indexOf('/media/uploads/session/quick-upload')).toBeLessThan(events.indexOf('/media/uploads/session/parts/0'));
  expect(fetch.mock.calls.filter(call => call[0].endsWith('/quick-upload'))).toHaveLength(1);
  expect(changed.mock.calls.at(-1)![0][0].session.quickIntent.id).toBe('intent');
});

it('routes completed resumable media through one server consent and fails closed when enrollment is disabled', async () => {
  const session: any = { id: 'media', media: { id: 'media' }, originalName: 'video.mp4', byteSize: 1, status: 'COMPLETE', parts: [] };
  let enrollments = 0, disabled = false;
  const fetch = jest.fn(async (url: string, options?: RequestInit) => {
    if (url.endsWith('/quick-upload')) {
      if (disabled) return { ok: false, status: 400, json: async () => ({ message: 'Enrollment is disabled' }) } as Response;
      enrollments++; session.quickIntent = { id: 'intent', status: 'WAITING', results: [] };
      return { ok: true, json: async () => session.quickIntent } as Response;
    }
    return { ok: true, json: async () => JSON.parse(JSON.stringify(session)) } as Response;
  });
  const transfers = new ResumableTransfers(fetch, jest.fn(), 'org');
  const body = { confirmNoIndividualReview: true as const, destinations: [{ id: 'x', settings: {} }] };
  expect(await transfers.tryCompletedQuickUpload('media', body)).toBe(true);
  await expect(transfers.tryCompletedQuickUpload('media', body)).rejects.toThrow('saved Quick Upload'); expect(enrollments).toBe(1);
  session.quickIntent = undefined; disabled = true;
  await expect(transfers.tryCompletedQuickUpload('media', body)).rejects.toThrow('disabled'); expect(enrollments).toBe(1);
});

it.each([['empty.mp4', 0], ['wrong.txt', 4]])('allows original-file reselection after rejecting %s', async (name, size) => {
  const f = fixture(); f.fail(1); f.transfers.start(file());
  await waitFor(() => expect(current(f).state).toBe('Resume needed'));
  await f.transfers.resume(current(f).id, new NodeFile([Buffer.alloc(size)], name) as unknown as File);
  expect(current(f).error).toContain('Choose an MP4 or MOV');
  expect(f.transfers.hasFile(current(f).id)).toBe(false);
  await f.transfers.resume(current(f).id, file());
  expect(current(f).state).toBe('Transfer complete');
});

it('reconciles completed media during cancellation without a destructive request', async () => {
  const f = fixture(); f.lose(); const receipt = f.transfers.start(file(4));
  await waitFor(() => expect(current(f).state).toBe('Resume needed'));
  await f.transfers.cancel(current(f).id);
  expect(await receipt).toEqual({ id: 'saved-media' });
  expect(current(f).state).toBe('Transfer complete');
  expect(f.requests.some(request => request.options?.method === 'DELETE')).toBe(false);
});

it('dismisses only terminal transfers locally and keeps them dismissed after polling and return', async () => {
  const f = fixture(); await f.transfers.start(file(4));
  await waitFor(() => expect(f.transfers.canDismiss(current(f))).toBe(true));
  const before = f.requests.length;
  f.transfers.dismiss(current(f).id);
  expect(f.requests).toHaveLength(before);
  expect(f.changed.mock.calls.at(-1)[0]).toEqual([]);
  await f.transfers.refresh();
  const returned = new ResumableTransfers((f.transfers as any).fetch, f.changed, 'org');
  await returned.refresh();
  expect(f.changed.mock.calls.at(-1)[0]).toEqual([]);
  expect(f.requests.some(request => request.options?.method === 'DELETE')).toBe(false);
});

it.each(['UPLOADING', 'FINALIZING'])('retains uncertain %s sessions and files after cancellation conflict', async status => {
  const f = fixture(); f.fail(0); f.transfers.start(file(4));
  await waitFor(() => expect(current(f).state).toBe('Resume needed'));
  f.getSession().status = status;
  const originalFetch = (f.transfers as any).fetch;
  (f.transfers as any).fetch = jest.fn((url, options) => options?.method === 'DELETE'
    ? Promise.resolve({ ok: false, status: 409, json: async () => ({ message: 'Request still active' }) })
    : originalFetch(url, options));
  const id = current(f).id;
  await expect(f.transfers.cancel(id)).rejects.toThrow(status === 'FINALIZING' ? 'finalizing' : 'still active');
  expect(f.transfers.hasFile(id)).toBe(true);
  expect(current(f).session.status).toBe(status);
  f.transfers.dismiss(id);
  expect(current(f).id).toBe(id);
  if (status === 'FINALIZING') expect(current(f).state).toBe('Finalizing');
});

it('keeps pending Quick Upload work visible and preserves partial destination outcomes', async () => {
  const f = fixture(); await f.transfers.start(file(4));
  const session = f.getSession();
  session.quickIntent = { id: 'quick', status: 'PUBLISHING', results: [
    { integrationId: 'youtube', name: 'YouTube', state: 'Published' },
    { integrationId: 'x', name: 'X', state: 'Failed', reason: 'Provider rejected upload' },
  ] };
  await f.transfers.refresh();
  f.transfers.dismiss(current(f).id);
  expect(current(f).session.quickIntent.results).toEqual(session.quickIntent.results);
  expect(f.transfers.canDismiss(current(f))).toBe(false);
  session.quickIntent.status = 'COMPLETE'; await f.transfers.refresh();
  expect(f.transfers.canDismiss(current(f))).toBe(true);
  f.transfers.dismiss(current(f).id);
  expect(f.changed.mock.calls.at(-1)[0]).toEqual([]);
});

it('waits for the aborted local part before cancelling and retains the file while its server lease is busy', async () => {
  const changed = jest.fn(); let session: any, partActive = false, localSettled = false, deletes = 0;
  const fetch = jest.fn(async (url: string, options?: RequestInit) => {
    if (url === '/media/uploads' && options?.method === 'POST') session = { ...JSON.parse(String(options.body)), id: 'busy-session', status: 'UPLOADING', parts: [] };
    if (url.includes('/parts/')) {
      partActive = true;
      await new Promise((_, reject) => options!.signal!.addEventListener('abort', () => { localSettled = true; reject(new DOMException('Paused', 'AbortError')); }, { once: true }));
    }
    if (options?.method === 'DELETE') {
      expect(localSettled).toBe(true); deletes++;
      return { ok: false, status: 409, json: async () => ({ message: 'Server lease still active' }) } as Response;
    }
    return { ok: true, json: async () => JSON.parse(JSON.stringify(session)) } as Response;
  });
  const transfers = new ResumableTransfers(fetch, changed, 'org');
  transfers.start(file(4));
  await waitFor(() => expect(partActive).toBe(true));
  const id = changed.mock.calls.at(-1)[0][0].id;
  const first = transfers.cancel(id);
  expect(transfers.cancel(id)).toBe(first);
  await expect(first).rejects.toThrow('Server lease still active');
  expect(deletes).toBe(1);
  expect(transfers.hasFile(id)).toBe(true);
  expect(changed.mock.calls.at(-1)[0][0].state).toBe('Paused');
  expect(fetch.mock.calls.filter(([url]) => url.endsWith('/complete'))).toHaveLength(0);
});
