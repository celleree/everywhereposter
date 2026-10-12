export const CHUNK_BYTES = 8 * 1024 * 1024;
export type UploadSession = {
  id: string; clientId?: string; originalName: string; byteSize: number; manifest: string[];
  status: string; parts: { index: number; digest: string; byteSize: number }[];
  media?: any; error?: string; expiresAt?: string;
};
export type TransferState = 'Uploading' | 'Paused' | 'Resume needed' | 'Transfer complete' | 'Failed';
export type Transfer = { id: string; name: string; bytes: number; sent: number; state: TransferState; session?: UploadSession; error?: string };
type Fetch = (url: string, options?: RequestInit) => Promise<Response>;

export async function fileManifest(file: Blob, signal?: AbortSignal) {
  const hashes: string[] = [];
  for (let offset = 0; offset < file.size; offset += CHUNK_BYTES) {
    if (signal?.aborted) throw new DOMException('Upload paused', 'AbortError');
    const hash = await crypto.subtle.digest('SHA-256', await file.slice(offset, offset + CHUNK_BYTES).arrayBuffer());
    hashes.push(Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join(''));
  }
  if (signal?.aborted) throw new DOMException('Upload paused', 'AbortError');
  return hashes;
}

// Owned by the authenticated layout, independent of modal and route lifetimes.
export class ResumableTransfers {
  private files = new Map<string, File>();
  private controllers = new Map<string, AbortController>();
  private pendingCreations = new Set<string>();
  private receipts = new Map<string, { resolve: (media: any) => void; reject: (error: Error) => void }>();
  private items = new Map<string, Transfer>();
  private disposed = false;
  constructor(private fetch: Fetch, private changed: (items: Transfer[]) => void, private organizationId: string) {}
  activate() { this.disposed = false; }
  private update(item: Transfer) {
    if (this.disposed) return;
    this.items.set(item.id, item); this.changed([...this.items.values()]);
  }
  private async request(url: string, options?: RequestInit) {
    if (this.disposed) throw new Error('Transfer controller is closed.');
    const response = await this.fetch('/media/uploads' + url, options);
    if (!response.ok) {
      let message = 'Upload request failed. Resume to reconcile the saved parts.';
      try { const body = await response.json(); message = Array.isArray(body.message) ? body.message.join(' ') : body.message || message; } catch {}
      const error = new Error(message); (error as any).status = response.status; throw error;
    }
    return response.json();
  }
  async refresh() {
    const result = await this.request('');
    for (const session of result.sessions as UploadSession[]) {
      const existing = [...this.items.values()].find(item => item.session?.id === session.id || item.id === session.clientId);
      if (existing) {
        if (!existing.session) this.update({ ...existing, session });
        if (!this.controllers.has(existing.id) && session.status === 'COMPLETE' && session.media?.id) {
          this.update({ ...existing, session, sent: existing.bytes, state: 'Transfer complete', error: undefined });
          this.receipts.get(existing.id)?.resolve(session.media); this.receipts.delete(existing.id); this.files.delete(existing.id);
        }
        continue;
      }
      this.update({ id: session.id, name: session.originalName, bytes: session.byteSize, sent: session.parts.reduce((sum, part) => sum + part.byteSize, 0), session,
        state: session.status === 'COMPLETE' ? 'Transfer complete' : session.status === 'FAILED' ? 'Failed' : 'Resume needed', error: session.error });
    }
    return result;
  }
  start(file: File) {
    const id = crypto.randomUUID();
    this.files.set(id, file);
    const receipt = new Promise<any>((resolve, reject) => this.receipts.set(id, { resolve, reject }));
    this.update({ id, name: file.name, bytes: file.size, sent: 0, state: 'Uploading' });
    void this.run(id);
    return receipt;
  }
  async resume(id: string, file?: File) {
    if (file) this.files.set(id, file);
    if (!this.files.has(id)) throw new Error('Select the original video to resume.');
    await this.run(id);
  }
  pause(id: string) {
    this.controllers.get(id)?.abort();
    const item = this.items.get(id);
    if (item && item.state !== 'Transfer complete') this.update({ ...item, state: 'Paused' });
  }
  async cancel(id: string) {
    this.pause(id);
    if (!this.items.get(id)?.session && this.pendingCreations.has(id)) {
      await this.refresh();
      if (!this.items.get(id)?.session) throw new Error('Upload session creation is uncertain. Return to the saved upload before cancelling.');
    }
    const item = this.items.get(id);
    if (item?.session) await this.request('/' + item.session.id, { method: 'DELETE' });
    this.pendingCreations.delete(id);
    this.items.delete(id); this.files.delete(id);
    this.receipts.get(id)?.reject(new Error('Upload cancelled.')); this.receipts.delete(id);
    this.changed([...this.items.values()]);
  }
  dispose() {
    this.disposed = true;
    for (const controller of this.controllers.values()) controller.abort();
    this.controllers.clear(); this.files.clear();
  }
  private async run(id: string) {
    if (this.disposed || this.controllers.has(id)) return;
    let item = this.items.get(id)!;
    const file = this.files.get(id)!;
    const controller = new AbortController();
    const creationWasPending = this.pendingCreations.has(id);
    this.controllers.set(id, controller);
    this.update({ ...item, state: 'Uploading', error: undefined });
    try {
      if (!/\.(mp4|mov)$/i.test(file.name) || !file.size) throw new Error('Choose an MP4 or MOV video.');
      const manifest = await fileManifest(file, controller.signal);
      let session: UploadSession;
      if (item.session) {
        session = await this.request('/' + item.session.id, { signal: controller.signal });
        if (file.size !== session.byteSize || JSON.stringify(manifest) !== JSON.stringify(session.manifest)) throw new Error('This is not the original file. Select the original video.');
      } else {
        this.pendingCreations.add(id);
        session = await this.request('', { method: 'POST', body: JSON.stringify({ organizationId: this.organizationId, clientId: id, originalName: file.name, byteSize: file.size, manifest }), signal: controller.signal });
      }
      if (this.items.has(id)) this.update({ ...this.items.get(id)!, session });
      this.pendingCreations.delete(id);
      if (controller.signal.aborted || !this.items.has(id)) throw new DOMException('Upload paused', 'AbortError');
      item = { ...item, session, sent: session.parts.reduce((sum, part) => sum + part.byteSize, 0), state: 'Uploading' };
      this.update(item);
      if (session.status === 'FAILED') throw new Error(session.error || 'Video validation failed.');
      if (session.status !== 'COMPLETE' && session.status !== 'FINALIZING') {
        for (let index = 0; index < manifest.length; index++) {
          if (session.parts.some(part => part.index === index)) continue;
          if (controller.signal.aborted) throw new DOMException('Upload paused', 'AbortError');
          session = await this.request(`/${session.id}/parts/${index}`, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: file.slice(index * CHUNK_BYTES, (index + 1) * CHUNK_BYTES), signal: controller.signal });
          item = { ...item, session, sent: session.parts.reduce((sum, part) => sum + part.byteSize, 0) }; this.update(item);
        }
      }
      if (session.status !== 'COMPLETE') session = await this.request('/' + session.id + '/complete', { method: 'POST', signal: controller.signal });
      if (session.status !== 'COMPLETE' || !session.media?.id) throw new Error('Server completion is pending. Resume to check its result.');
      this.update({ ...item, session, sent: file.size, state: 'Transfer complete' });
      this.receipts.get(id)?.resolve(session.media); this.receipts.delete(id); this.files.delete(id);
    } catch (error) {
      // A lost acknowledgement never creates a new identity or automatically retries.
      const status = (error as any).status;
      if (!creationWasPending && status >= 400 && status < 500 && status !== 408) this.pendingCreations.delete(id);
      const remaining = this.items.get(id);
      if (!this.disposed && remaining) {
        this.update({ ...remaining, state: controller.signal.aborted ? 'Paused' : (error as any).status === 400 ? 'Failed' : 'Resume needed', error: controller.signal.aborted ? undefined : (error as Error).message });
      }
      if (status === 400) { this.receipts.get(id)?.reject(error as Error); this.receipts.delete(id); this.files.delete(id); }
    } finally { this.controllers.delete(id); }
  }
}
