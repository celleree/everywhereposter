export const CHUNK_BYTES = 8 * 1024 * 1024;
export type QuickIntent = { id: string; status: string; results: { integrationId: string; name: string; state: string; reason?: string }[]; message?: string };
export type QuickConsent = { confirmNoIndividualReview: true; destinations: { id: string; settings: Record<string, any> }[] };
export type UploadSession = {
  quickIntent?: QuickIntent;
  id: string; clientId?: string; originalName: string; byteSize: number; manifest: string[];
  status: string; parts: { index: number; digest: string; byteSize: number }[];
  media?: any; error?: string; expiresAt?: string;
};
export type TransferState = 'Uploading' | 'Paused' | 'Resume needed' | 'Transfer complete' | 'Failed';
export type Transfer = { id: string; name: string; bytes: number; sent: number; state: TransferState; session?: UploadSession; error?: string; quickRequested?: boolean; quickError?: string };
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
  durableQuickUploadEnabled = false;
  private consents = new Map<string, QuickConsent>();
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
    this.durableQuickUploadEnabled = result.durableQuickUploadEnabled === true;
    for (const session of result.sessions as UploadSession[]) {
      const existing = [...this.items.values()].find(item => item.session?.id === session.id || item.id === session.clientId);
      if (existing) {
        this.update({ ...existing, session });
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
  async tryCompletedQuickUpload(mediaId: string, body: QuickConsent) {
    let session: UploadSession;
    try { session = await this.request('/' + encodeURIComponent(mediaId)); }
    catch (error) { if ((error as any).status === 404) return false; throw error; }
    if (session.status !== 'COMPLETE' || !session.media?.id) throw new Error('Wait for server-confirmed video completion.');
    if (session.quickIntent) throw new Error('This video already has a saved Quick Upload choice. Check its transfer progress; use Customize for a separate post.');
    const item = [...this.items.values()].find(value => value.session?.id === session.id) || {
      id: session.id, name: session.originalName, bytes: session.byteSize, sent: session.byteSize, state: 'Transfer complete' as const,
    };
    this.update({ ...item, session });
    // Resumable media always uses server consent. Disabled enrollment never falls
    // back to the old browser generator, which could race a later durable choice.
    await this.optIntoQuickUpload(item.id, body);
    return true;
  }
  async assertNoQuickUpload(mediaId: string) {
    let session: UploadSession;
    try { session = await this.request('/' + encodeURIComponent(mediaId)); }
    catch (error) { if ((error as any).status === 404) return; throw error; }
    if (session.quickIntent && session.quickIntent.status !== 'CANCELLED') throw new Error('This video already has a saved Quick Upload job. Check its transfer progress; use Customize for a separate post.');
  }
  async optIntoQuickUpload(id: string, body: QuickConsent) {
    const item = this.items.get(id);
    if (!item || item.session?.quickIntent) return;
    const previous = this.consents.get(id);
    if (previous && JSON.stringify(previous) !== JSON.stringify(body)) throw new Error('Consent is immutable. Resume the saved choice.');
    this.consents.set(id, body);
    this.update({ ...item, quickRequested: true, quickError: undefined });
    if (item.session) await this.persistConsent(id, item.session);
  }
  private async persistConsent(id: string, session: UploadSession) {
    const body = this.consents.get(id);
    if (!body || session.quickIntent) return;
    try {
      const quickIntent = await this.request('/' + session.id + '/quick-upload', { method: 'POST', body: JSON.stringify(body) });
      const item = this.items.get(id);
      if (item) this.update({ ...item, session: { ...item.session!, quickIntent }, quickError: undefined });
    } catch (error) {
      const item = this.items.get(id);
      if (item) this.update({ ...item, quickError: 'Consent confirmation failed. Resume to reconcile the saved intent.' });
      throw error;
    }
  }
  async retryQuickUpload(id: string) {
    const item = this.items.get(id);
    if (item?.session) await this.persistConsent(id, item.session);
  }
  async cancelQuickUpload(id: string) {
    const item = this.items.get(id);
    if (item?.session?.quickIntent) {
      const quickIntent = await this.request('/' + item.session.id + '/quick-upload', { method: 'DELETE' });
      this.update({ ...item, session: { ...item.session, quickIntent } });
    }
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
    this.items.delete(id); this.files.delete(id); this.consents.delete(id);
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
      item = { ...item, ...this.items.get(id), session, sent: session.parts.reduce((sum, part) => sum + part.byteSize, 0), state: 'Uploading' };
      this.update(item);
      if (session.status === 'FAILED') throw new Error(session.error || 'Video validation failed.');
      if (session.status !== 'COMPLETE' && session.status !== 'FINALIZING') {
        for (let index = 0; index < manifest.length; index++) {
          if (session.parts.some(part => part.index === index)) continue;
          await this.persistConsent(id, this.items.get(id)?.session || session);
          if (controller.signal.aborted) throw new DOMException('Upload paused', 'AbortError');
          session = await this.request(`/${session.id}/parts/${index}`, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: file.slice(index * CHUNK_BYTES, (index + 1) * CHUNK_BYTES), signal: controller.signal });
          session.quickIntent ||= this.items.get(id)?.session?.quickIntent;
          item = { ...item, quickRequested: this.items.get(id)?.quickRequested, session, sent: session.parts.reduce((sum, part) => sum + part.byteSize, 0) }; this.update(item);
        }
      }
      await this.persistConsent(id, this.items.get(id)?.session || session);
      if (session.status !== 'COMPLETE') session = await this.request('/' + session.id + '/complete', { method: 'POST', signal: controller.signal });
      if (session.status !== 'COMPLETE' || !session.media?.id) throw new Error('Server completion is pending. Resume to check its result.');
      session.quickIntent ||= this.items.get(id)?.session?.quickIntent;
      this.update({ ...item, quickRequested: this.items.get(id)?.quickRequested, session, sent: file.size, state: 'Transfer complete' });
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
