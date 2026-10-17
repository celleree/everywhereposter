import { assertValidVideoEditDecisionList, getKeptDurationMs, PacingPreset } from '@gitroom/nestjs-libraries/media-editing/video-edit-decision';

export type Video = { id: string; path: string; originalName?: string | null; type?: string | null };
export type EditReceipt = { version: 1; sourceId: string; pacing: PacingPreset; status: 'pending' | 'complete' | 'rejected'; outputId?: string; durationMs?: number; sourceDurationMs?: number; message?: string };
export type EditView = { status: 'idle' | 'editing' | 'checking' | 'complete' | 'rejected' | 'unknown'; output?: Video; receipt?: EditReceipt; message?: string };
class RecoveryError extends Error {}
type Fetch = (url: string, options?: RequestInit) => Promise<Response>;
export function mediaUrl(path: string) {
  const url = new URL(path, window.location.origin);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Invalid media address.');
  return url;
}
export function isVideo(value: any, id: string): value is Video {
  if (typeof id !== 'string' || !id.trim() || id.length > 200 || !value || value.id !== id || typeof value.path !== 'string' || !value.path.trim() ||
      (value.originalName != null && typeof value.originalName !== 'string') ||
      !(['video', 'video/mp4', 'video/quicktime'].includes(value.type) || (!value.type && /\.(mp4|mov)(?:$|[?#])/i.test(value.originalName || value.path)))) return false;
  try { mediaUrl(value.path); return true; } catch { return false; }
}
export function editReceipt(value: any, sourceId: string, pacing: PacingPreset): EditReceipt {
  assertValidVideoEditDecisionList(value?.editDecisionList);
  const { outputMedia: output, render, editDecisionList: list } = value;
  const kept = getKeptDurationMs(list);
  if (value.schemaVersion !== 1 || !output?.id || output.id === sourceId || !isVideo(output, output.id) ||
      list.source.mediaId !== sourceId || list.source.durationMs > 60_000 || list.pacingPreset !== pacing ||
      render?.status !== 'completed' || render.container !== 'mp4' || render.videoCodec !== 'h264' || render.audioCodec !== 'aac' ||
      !Number.isInteger(render.durationMs) || render.durationMs <= 0 || render.durationMs > 60_750 ||
      Math.abs(render.durationMs - kept) > Math.max(750, Math.round(kept * .08))) throw new Error('The edited result could not be verified.');
  return { version: 1, sourceId, pacing, status: 'complete', outputId: output.id, durationMs: render.durationMs, sourceDurationMs: list.source.durationMs };
}

// Browser receipts prevent automatic replay; the synchronous API has no durable job or server cancellation.
export class VideoEditClient {
  private controller?: AbortController;
  private busy = false;
  private disposed = false;
  constructor(private fetch: Fetch, private storage: Storage, private scope: string, private changed: (view: EditView) => void) {}
  activate() { this.disposed = false; }
  private emit(view: EditView) { if (!this.disposed) this.changed(view); }
  private key(sourceId: string, pacing: PacingPreset) { return 'everywhereposter:video-edit:v1:' + this.scope + ':' + encodeURIComponent(sourceId) + ':' + pacing; }
  private read(key: string, sourceId: string, pacing: PacingPreset) {
    let raw: string | null;
    try { raw = this.storage.getItem(key); } catch { throw new RecoveryError('Saved edit information could not be read. Check Media Library before creating another copy.'); }
    if (!raw) return;
    if (raw.length > 4000) throw new RecoveryError('Saved edit information is invalid. Check Media Library before creating another copy.');
    let record: EditReceipt;
    try { record = JSON.parse(raw); } catch { throw new RecoveryError('Saved edit information is invalid. Check Media Library before creating another copy.'); }
    if (record?.version !== 1 || record.sourceId !== sourceId || record.pacing !== pacing || !['pending', 'complete', 'rejected'].includes(record.status) ||
        (record.status === 'complete' && (typeof record.outputId !== 'string' || !record.outputId || record.outputId === sourceId ||
          !Number.isInteger(record.durationMs) || record.durationMs! <= 0 || record.durationMs! > 60_750 ||
          !Number.isInteger(record.sourceDurationMs) || record.sourceDurationMs! <= 0 || record.sourceDurationMs! > 60_000))) throw new RecoveryError('Saved edit information is invalid. Check Media Library before creating another copy.');
    return record;
  }
  stop() { this.controller?.abort(); }
  dispose() { this.disposed = true; this.stop(); }
  async edit(source: Video, pacing: PacingPreset, deliberateRetry = false) {
    if (this.busy || this.disposed) return;
    this.busy = true;
    const controller = new AbortController(); this.controller = controller;
    const key = this.key(source.id, pacing);
    let receipt: EditReceipt | undefined, started = false;
    const timer = setTimeout(() => controller.abort(), 240_000);
    const verify = async (saved: EditReceipt, expectedPath?: string) => {
      this.emit({ status: 'checking', receipt: saved });
      const response = await this.fetch('/media/' + encodeURIComponent(saved.outputId!), { signal: controller.signal });
      const media = response.ok ? await response.json() : null;
      if (!isVideo(media, saved.outputId!) || (expectedPath && media.path !== expectedPath)) throw new Error('Saved output is not available for this workspace.');
      if (controller.signal.aborted) throw new Error('Stopped waiting for the result.');
      this.emit({ status: 'complete', receipt: saved, output: media });
    };
    try {
      receipt = this.read(key, source.id, pacing);
      if (receipt?.status === 'complete' && !deliberateRetry) { await verify(receipt); return; }
      if (receipt && !deliberateRetry) {
        this.emit({ status: receipt.status === 'rejected' ? 'rejected' : 'unknown', receipt, message: receipt.message || 'An earlier edit may still finish. Check Media Library before creating another copy.' }); return;
      }
      if (!navigator.locks?.request) throw new Error('This browser cannot safely coordinate automatic editing. Use a browser with secure task locking.');
      await navigator.locks.request('everywhereposter:video-edit-lock:' + this.scope, { ifAvailable: true }, async lock => {
        if (!lock) { this.emit({ status: 'unknown', message: 'Another tab is editing this video. Check its result before creating another copy.' }); return; }
        const current = this.read(key, source.id, pacing);
        if (current && !deliberateRetry) {
          if (current.status === 'complete') await verify(current);
          else this.emit({ status: current.status === 'rejected' ? 'rejected' : 'unknown', receipt: current, message: current.message || 'An earlier edit may still finish. Check Media Library before creating another copy.' });
          return;
        }
        if (controller.signal.aborted || this.disposed) return;
        const pending: EditReceipt = { version: 1, sourceId: source.id, pacing, status: 'pending' };
        try { this.storage.setItem(key, JSON.stringify(pending)); } catch { throw new Error('Browser recovery could not be saved. No edit was started.'); }
        receipt = pending;
        started = true; this.emit({ status: 'editing', receipt });
        const response = await this.fetch('/media/' + encodeURIComponent(source.id) + '/video-edits', { method: 'POST', body: JSON.stringify({ schemaVersion: 1, pacingPreset: pacing }), signal: controller.signal });
        if (!response.ok) {
          if ([400, 401, 403, 404, 422, 429].includes(response.status)) {
            let message = 'The edit was rejected. Check the source and try again deliberately.';
            try { const body = await response.json(); if (typeof body.message === 'string') message = body.message.slice(0, 500); } catch {}
            receipt = { ...receipt, status: 'rejected', message }; this.storage.setItem(key, JSON.stringify(receipt));
            this.emit({ status: 'rejected', receipt, message }); return;
          }
          throw new Error('The server outcome is uncertain.');
        }
        const body = await response.json();
        receipt = editReceipt(body, source.id, pacing);
        this.storage.setItem(key, JSON.stringify(receipt));
        if (controller.signal.aborted || this.disposed) { this.emit({ status: 'unknown', receipt, message: 'The server saved an edited copy. Check the saved result.' }); return; }
        await verify(receipt, body.outputMedia.path);
      });
    } catch (error) {
      this.emit({ status: started || receipt || error instanceof RecoveryError ? 'unknown' : 'rejected', receipt,
        message: started || receipt ? 'The edited result is not confirmed here. Check Media Library; this request will not retry automatically.' : (error as Error).message });
    } finally { clearTimeout(timer); this.busy = false; if (this.controller === controller) this.controller = undefined; }
  }
}

export async function downloadVideo(video: Video, signal: AbortSignal) {
  const response = await window.fetch(mediaUrl(video.path).href, { credentials: 'omit', redirect: 'error', signal });
  const limit = 100 * 1024 * 1024;
  if (!response.ok || !response.body || Number(response.headers.get('content-length')) > limit) throw new Error('The edited video could not be downloaded.');
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const next = await reader.read(); if (next.done) break;
      size += next.value.byteLength;
      if (size > limit) throw new Error('The download exceeds the supported video size.');
      chunks.push(next.value);
    }
  } finally { await reader.cancel(); }
  if (!size || signal.aborted) throw new Error('Download cancelled or empty.');
  const url = URL.createObjectURL(new Blob(chunks, { type: 'video/mp4' }));
  const link = document.createElement('a'); link.href = url;
  link.download = (video.originalName || 'edited-video.mp4').replace(/[\\/\x00-\x1f]/g, '_').slice(0, 200);
  link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
