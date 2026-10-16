export const CHUNK_BYTES = 8 * 1024 * 1024;
export type QuickIntent = { id: string; status: string; results: { integrationId: string; name: string; state: string; reason?: string }[]; message?: string };
export type QuickConsent = { confirmNoIndividualReview: true; destinations: { id: string; settings: Record<string, any> }[] };
export type UploadSession = {
  quickIntent?: QuickIntent;
  id: string; clientId?: string; originalName: string; byteSize: number; manifest: string[];
  status: string; parts: { index: number; digest: string; byteSize: number }[];
  media?: any; error?: string; expiresAt?: string;
};
export type TransferState = 'Uploading' | 'Paused' | 'Resume needed' | 'Transfer complete' | 'Finalizing' | 'Failed';
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
  private runs = new Map<string, Promise<void>>();
  private cancellations = new Map<string, Promise<void>>();
  private dismissed = new Set<string>();
  private disposed = false;
  constructor(private fetch: Fetch, private changed: (items: Transfer[]) => void, private organizationId: string) {
    try { this.dismissed = new Set(JSON.parse(localStorage.getItem(this.dismissKey()) || '[]')); } catch {}
  }
  private dismissKey() { return 'everywhereposter:dismissed-transfers:' + this.organizationId; }
  canDismiss(item: Transfer) {
    return item.session?.status === 'COMPLETE' && !!item.session.media?.id &&
      !this.controllers.has(item.id) && !this.cancellations.has(item.id) &&
      !this.pendingCreations.has(item.id) && !item.quickError &&
      (!item.quickRequested || !!item.session.quickIntent) &&
      (!item.session.quickIntent || ['COMPLETE', 'FAILED', 'CANCELLED'].includes(item.session.quickIntent.status));
  }
  dismiss(id: string) {
    const item = this.items.get(id);
    if (!item || !this.canDismiss(item)) return;
    this.dismissed.add(item.session!.id);
    try { localStorage.setItem(this.dismissKey(), JSON.stringify([...this.dismissed].slice(-200))); } catch {}
    this.items.delete(id); this.consents.delete(id);
    this.changed([...this.items.values()]);
  }
  dismissAttached(mediaIds: Set<string>, protectedIds = new Set<string>()) {
    for (const item of this.items.values()) {
      // Attachment is separate from server completion. Keep publishing receipts,
      // consent uncertainty and errors visible even when media is attached.
      if (!protectedIds.has(item.id) && mediaIds.has(item.session?.media?.id) && !item.error && !item.quickError &&
          !item.quickRequested && !item.session?.quickIntent && this.canDismiss(item)) {
        this.dismiss(item.id);
      }
    }
  }
  private reconcile(item: Transfer, session: UploadSession) {
    if (item.session?.status === 'COMPLETE' && item.session.media?.id && session.status !== 'COMPLETE') return;
    const complete = session.status === 'COMPLETE' && !!session.media?.id;
    this.update({ ...item, session, ...(complete ? { state: 'Transfer complete' as const, sent: item.bytes, error: undefined } :
      session.status === 'FINALIZING' ? { state: 'Finalizing' as const, error: undefined } : {}) });
    if (complete) {
      this.receipts.get(item.id)?.resolve(session.media); this.receipts.delete(item.id); this.files.delete(item.id);
    }
  }
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
      if (this.dismissed.has(session.id)) continue;
      const existing = [...this.items.values()].find(item => item.session?.id === session.id || item.id === session.clientId);
      if (existing) {
        this.reconcile(existing, session);
        continue;
      }
      this.update({ id: session.id, name: session.originalName, bytes: session.byteSize, sent: session.parts.reduce((sum, part) => sum + part.byteSize, 0), session,
        state: session.status === 'COMPLETE' && session.media?.id ? 'Transfer complete' : session.status === 'FINALIZING' ? 'Finalizing' : session.status === 'FAILED' ? 'Failed' : 'Resume needed', error: session.error });
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
    // A later explicit publishing choice restores polling for an attached upload
    // whose presentation was dismissed earlier. Never hide its new results.
    this.dismissed.delete(session.id);
    try { localStorage.setItem(this.dismissKey(), JSON.stringify([...this.dismissed].slice(-200))); } catch {}
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
  hasFile(id: string) { return this.files.has(id); }
  async resume(id: string, file?: File) {
    if (this.disposed || this.cancellations.has(id) || this.controllers.has(id) || !this.items.has(id) || this.items.get(id)?.state === 'Transfer complete') return;
    if (file) this.files.set(id, file);
    if (!this.files.has(id)) throw new Error('Select the original video to resume.');
    await this.run(id);
  }
  pause(id: string) {
    this.controllers.get(id)?.abort();
    const item = this.items.get(id);
    if (item && item.state !== 'Transfer complete') this.update({ ...item, state: 'Paused' });
  }
  cancel(id: string) {
    const existing = this.cancellations.get(id);
    if (existing) return existing;
    const pending = this.cancelTransfer(id).finally(() => { this.cancellations.delete(id); if (!this.disposed) this.changed([...this.items.values()]); });
    this.cancellations.set(id, pending);
    return pending;
  }
  private async cancelTransfer(id: string) {
    this.pause(id);
    await this.runs.get(id);
    if (!this.items.get(id)?.session && this.pendingCreations.has(id)) {
      await this.refresh();
      if (!this.items.get(id)?.session) throw new Error('Upload session creation is uncertain. Return to the saved upload before cancelling.');
    }
    const item = this.items.get(id);
    if (item?.session) {
      const session = await this.request('/' + item.session.id);
      this.reconcile(item, session);
      if (session.status === 'COMPLETE' && session.media?.id) return;
      if (session.status === 'FINALIZING') throw new Error('The server is finalizing this video. Check its progress before cancelling.');
      try { await this.request('/' + session.id, { method: 'DELETE' }); }
      catch (error) {
        // A browser abort does not prove server work stopped. Keep the row/file on uncertainty.
        try {
          const saved = await this.request('/' + session.id);
          this.reconcile(this.items.get(id) || item, saved);
          if (saved.status === 'COMPLETE' && saved.media?.id) return;
        } catch {}
        throw error;
      }
    }
    if (item?.session) this.dismissed.add(item.session.id);
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
  private run(id: string) {
    const existing = this.runs.get(id);
    if (existing) return existing;
    const pending = this.execute(id).finally(() => this.runs.delete(id));
    this.runs.set(id, pending);
    return pending;
  }
  private async execute(id: string) {
    if (this.disposed || this.controllers.has(id)) return;
    let item = this.items.get(id)!;
    const file = this.files.get(id)!;
    const controller = new AbortController();
    const creationWasPending = this.pendingCreations.has(id);
    this.controllers.set(id, controller);
    this.update({ ...item, state: 'Uploading', error: undefined });
    try {
      if (!/\.(mp4|mov)$/i.test(file.name) || !file.size) {
        this.files.delete(id);
        throw new Error('Choose an MP4 or MOV video.');
      }
      const manifest = await fileManifest(file, controller.signal);
      let session: UploadSession;
      if (item.session) {
        session = await this.request('/' + item.session.id, { signal: controller.signal });
        if (file.size !== session.byteSize || JSON.stringify(manifest) !== JSON.stringify(session.manifest)) {
          this.files.delete(id);
          throw new Error('This is not the original file. Select the original video.');
        }
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
      if (!this.disposed && remaining && remaining.session?.status !== 'COMPLETE') {
        this.update({ ...remaining, state: controller.signal.aborted ? 'Paused' : (error as any).status === 400 ? 'Failed' : 'Resume needed', error: controller.signal.aborted ? undefined : (error as Error).message });
      }
      if (status === 400) { this.receipts.get(id)?.reject(error as Error); this.receipts.delete(id); this.files.delete(id); }
    } finally { this.controllers.delete(id); if (!this.disposed) this.changed([...this.items.values()]); }
  }
}
