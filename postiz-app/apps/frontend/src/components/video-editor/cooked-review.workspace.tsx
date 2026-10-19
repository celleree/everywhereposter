'use client';
import { useEffect, useRef, useState } from 'react';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useModals } from '@gitroom/frontend/components/layout/new-modal';
import { MediaBox } from '@gitroom/frontend/components/media/media.component';
import { Button } from '@gitroom/react/form/button';
import { downloadVideo, isVideo } from './video-editor.client';
import styles from './video-editor.module.css';
import dayjs from 'dayjs';

type Video = { id: string; path: string; originalName?: string | null; type?: string | null };
type Session = { sourceId: string; requestId: string; jobId?: string; saved?: Video; savedRevision?: number; saving?: boolean };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export function CookedReviewWorkspace({ scope }: { scope: string }) {
  const fetch = useFetch(), modals = useModals();
  const key = 'everywhereposter:cooked-review:v1:' + scope;
  const [session, setSession] = useState<Session>(), current = useRef<Session | undefined>(undefined);
  const [source, setSource] = useState<Video>();
  const [recovering, setRecovering] = useState(false);
  const [url, setUrl] = useState(''), [pending, setPending] = useState(false), [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false), [opening, setOpening] = useState(false), [selecting, setSelecting] = useState(false);
  const [frameBusy, setFrameBusy] = useState(false), [frameHeight, setFrameHeight] = useState(800);
  const frame = useRef<HTMLIFrameElement>(null), busyFrame = useRef(false), operation = useRef(false);
  const scopeKey = useRef(key), generation = useRef(0), active = useRef(true);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined), download = useRef<AbortController | undefined>(undefined);
  const live = (epoch: number, s?: Session) => active.current && scopeKey.current === key && generation.current === epoch && (!s || current.current?.requestId === s.requestId);
  const write = (s: Session) => { localStorage.setItem(key, JSON.stringify(s)); current.current = s; setSession(s); };
  const base = (s: Session) => '/media/cooked/' + encodeURIComponent(s.sourceId);
  const validateSource = async (id: string) => {
    const response = await fetch('/media/' + encodeURIComponent(id));
    const video = response.ok ? await response.json() : null;
    if (!isVideo(video, id)) throw new Error('Choose an available MP4 or MOV video with audio.');
    return video;
  };
  const accept = (s: Session, response: Response, body: { jobId?: string; status?: string }, epoch: number) => {
    if (!live(epoch, s)) return false;
    if (body.status === 'failed') throw new Error('This edit could not finish. Close the session and choose the source again.');
    if (body.status !== 'ready' || !body.jobId || !UUID.test(body.jobId)) return false;
    const target = new URL(response.url); target.search = ''; target.pathname = target.pathname.replace(/\/find$/, '').replace(/\/$/, '') + '/' + body.jobId + '/review';
    if (target.origin !== window.location.origin) throw new Error('The editor requires the application’s same-origin backend proxy.');
    target.searchParams.set('request', s.requestId);
    write({ ...s, jobId: body.jobId }); setUrl(target.toString()); setPending(false); return true;
  };
  const recover = async (s: Session, epoch = generation.current) => {
    try {
      const response = await fetch(base(s) + '/find?request=' + s.requestId);
      const body = response.ok ? await response.json() : null;
      if (!live(epoch, s)) return;
      if (!response.ok) throw new Error('This editing session is unavailable or expired. Saved copies remain in Media Library.');
      if (!accept(s, response, body, epoch)) timer.current = setTimeout(() => void recover(s, epoch), 3000);
    } catch (e) { if (live(epoch, s)) { setPending(false); setMessage((e as Error).message); } }
  };
  useEffect(() => {
    active.current = true; scopeKey.current = key; const epoch = ++generation.current;
    current.current = undefined; operation.current = false; busyFrame.current = false;
    setSession(undefined); setSource(undefined); setUrl(''); setPending(false); setMessage(''); setSaving(false); setOpening(false); setSelecting(false); setRecovering(false); setFrameBusy(false); setFrameHeight(800);
    try {
      const raw = localStorage.getItem(key);
      if (raw) {
        if (raw.length > 4096) throw new Error(); const s = JSON.parse(raw);
        if (!s || !/^[\w-]{1,128}$/.test(s.sourceId) || !UUID.test(s.requestId)) throw new Error();
        if (s.saved && !isVideo(s.saved, s.saved.id)) throw new Error();
        current.current = s; setSession(s); setPending(true); setRecovering(true); void recover(s, epoch);
        void validateSource(s.sourceId).then(video => { if (live(epoch, s)) setSource(video); }).catch(() => {});
        if (s.saving) setMessage('A copy may already have been saved. Check Media Library before saving again.');
      }
    } catch { setMessage('The saved editing session could not be recovered. Choose a video deliberately to start again.'); }
    return () => { active.current = false; ++generation.current; clearTimeout(timer.current); download.current?.abort(); };
  }, [key]);
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (!url || event.origin !== window.location.origin || event.source !== frame.current?.contentWindow || event.data?.type !== 'ep-cooked-review') return;
      const { height, busy } = event.data;
      if (!Number.isInteger(height) || !Number.isFinite(height) || typeof busy !== 'boolean') return;
      setFrameHeight(Math.max(240, Math.min(20000, height))); busyFrame.current = busy; setFrameBusy(busy);
    };
    window.addEventListener('message', receive); return () => window.removeEventListener('message', receive);
  }, [url]);
  const closeSession = async (epoch: number) => {
    const s = current.current; if (!s) return;
    if (busyFrame.current) throw new Error('Finish applying your changes before closing the session.');
    const response = await fetch(base(s) + '/request/' + s.requestId, { method: 'DELETE' });
    if (!live(epoch, s)) return;
    if (!response.ok && response.status !== 404) throw new Error('The session could not be closed. Try again after the current edit finishes.');
    localStorage.removeItem(key); clearTimeout(timer.current); current.current = undefined; setSession(undefined); setUrl(''); busyFrame.current = false; setFrameBusy(false); setFrameHeight(800);
  };
  const close = async () => {
    if (operation.current || busyFrame.current || pending) return;
    operation.current = true; setSelecting(true); const epoch = generation.current;
    try { await closeSession(epoch); if (live(epoch)) setMessage(''); }
    catch (e) { if (live(epoch)) setMessage((e as Error).message); }
    finally { if (live(epoch)) { operation.current = false; setSelecting(false); } }
  };
  const choose = () => {
    if (operation.current || busyFrame.current || pending) return;
    const epoch = generation.current;
    modals.openModal({ title: 'Media Library', contentClassName: 'upload-media-picker', askClose: false,
      closeOnEscape: true, fullScreen: true, size: 'calc(100% - 80px)', height: 'calc(100% - 80px)',
      children: (closePicker) => <MediaBox type="video" hideSourceTabs compactPicker closeModal={closePicker} setMedia={(items) => {
        if (!live(epoch) || operation.current || busyFrame.current) return;
        if (items.length !== 1 || !/^[\w-]{1,128}$/.test(String(items[0].id))) { setMessage('Choose exactly one video.'); return; }
        operation.current = true; setSelecting(true); setMessage('');
        void (async () => {
          try {
            const video = await validateSource(String(items[0].id));
            if (!live(epoch)) return;
            await closeSession(epoch); if (!live(epoch)) return;
            setSource(video); setMessage('');
          } catch (e) { if (live(epoch)) setMessage((e as Error).message); }
          finally { if (live(epoch)) { operation.current = false; setSelecting(false); } }
        })();
      }} /> });
  };
  const prepare = async () => {
    if (!source || current.current || operation.current) return;
    operation.current = true; setPending(true); setRecovering(false); setMessage(''); const epoch = generation.current;
    let s: Session | undefined;
    try {
      const video = await validateSource(source.id); if (!live(epoch)) return;
      setSource(video); s = { sourceId: video.id, requestId: crypto.randomUUID() }; write(s);
      const response = await fetch(base(s), { method: 'POST', body: JSON.stringify({ requestId: s.requestId }) });
      const body = response.ok ? await response.json() : null;
      if (!live(epoch, s)) return;
      if (!response.ok) throw new Error(response.status === 429 ? 'Another editing session is open. Try again later.' : 'The edit outcome is uncertain. Recover the session before starting another edit.');
      if (!accept(s, response, body, epoch)) void recover(s, epoch);
    } catch (e) { if (live(epoch, s)) { setPending(false); setMessage(s ? 'The edit outcome is uncertain. Recover the session before starting another edit.' : (e as Error).message); } }
    finally { if (live(epoch)) operation.current = false; }
  };
  const save = async () => {
    const s = current.current; if (!s?.jobId || operation.current || busyFrame.current || s.saving) return;
    operation.current = true; setSaving(true); setMessage(''); const epoch = generation.current;
    try {
      const stateResponse = await fetch(base(s) + '/' + s.jobId + '/state');
      const state = stateResponse.ok ? await stateResponse.json() : null;
      if (!live(epoch, s)) return;
      if (!stateResponse.ok) throw new Error('The current edit could not be checked.');
      if (state.busy || busyFrame.current) throw new Error('Finish applying your changes before saving.');
      write({ ...s, saving: true });
      const response = await fetch(base(s) + '/' + s.jobId + '/output', { method: 'POST', body: JSON.stringify({ revision: state.revision }) });
      const body = response.ok ? await response.json() : null;
      if (!live(epoch, s)) return;
      if (!response.ok) {
        if ([400, 401, 403, 404, 409, 422, 429].includes(response.status)) write({ ...s, saving: false });
        throw new Error('The copy could not be confirmed. Check Media Library before saving again.');
      }
      if (!isVideo(body.outputMedia, body.outputMedia?.id) || body.outputMedia.id === s.sourceId || body.revision !== state.revision) throw new Error('The saved copy could not be confirmed.');
      write({ ...s, saving: false, saved: body.outputMedia, savedRevision: body.revision });
    } catch (e) { if (live(epoch, s)) setMessage(current.current?.saving ? 'The copy could not be confirmed. Check Media Library before saving again.' : (e as Error).message); }
    finally { if (live(epoch)) { operation.current = false; setSaving(false); } }
  };
  const composer = async () => {
    const s = current.current, output = s?.saved; if (!output || operation.current || busyFrame.current) return;
    operation.current = true; setOpening(true); setMessage(''); const epoch = generation.current;
    try {
      const r = await fetch('/media/' + encodeURIComponent(output.id)); const confirmed = r.ok ? await r.json() : null;
      if (!live(epoch, s)) return;
      if (!isVideo(confirmed, output.id) || confirmed.path !== output.path) throw new Error('The saved video is unavailable.');
      const accounts = await fetch('/integrations/list'); const integrations = accounts.ok ? (await accounts.json()).integrations : null;
      if (!live(epoch, s)) return;
      if (!Array.isArray(integrations) || integrations.some(item => typeof item?.id !== 'string')) throw new Error('Connected accounts could not be loaded.');
      const { AddEditModal } = await import('@gitroom/frontend/components/new-launch/add.edit.modal');
      if (!live(epoch, s)) return;
      modals.openModal({ id: 'add-edit-modal', closeOnClickOutside: false, removeLayout: true, closeOnEscape: false, withCloseButton: false,
        askClose: true, fullScreen: true, size: '80%', title: '', classNames: { modal: 'w-[100%] max-w-[1400px] text-textColor' },
        children: <AddEditModal onlyValues={[{ content: '', image: [{ id: confirmed.id, path: confirmed.path }] }]} allIntegrations={integrations}
          integrations={integrations} date={dayjs()} reopenModal={() => {}} mutate={() => {}} /> });
    } catch (e) { if (live(epoch, s)) setMessage((e as Error).message); }
    finally { if (live(epoch)) { operation.current = false; setOpening(false); } }
  };
  const disabled = pending || saving || opening || selecting || frameBusy;
  return <main className={`${styles.workspace} ${styles.cookedWorkspace}`} aria-label="Video Editor workspace">
    <header className={styles.header}><div><h2>Review your video</h2><p>Cut or restore eligible whole speech blocks. Your original stays unchanged.</p></div>
      <Button className={styles.button} disabled={disabled} onClick={choose}>Choose video</Button></header>
    <p className={styles.notice}>English speech · MP4 or MOV with audio · Up to 4 minutes, 100 MiB, 720p and 30 fps · Requires aligned constant-frame-rate audio and video. Sessions expire after 15 idle minutes. Saved copies stay in Media Library.</p>
    <p className={styles.muted}>Whole speech blocks only. Individual word, filler-word, pause and style editing are unavailable.</p>
    {message && <p role="alert">{message}</p>}
    {selecting && <p role="status">Checking your video…</p>}
    {source && !url && <section className={styles.panel} aria-label="Source video"><h3>{source.originalName || 'Original video'}</h3>
      <div className={styles.preview}><video aria-label="Original video preview" controls playsInline preload="metadata" src={source.path} /></div>
      {!session && <Button className={styles.button} disabled={disabled} onClick={() => void prepare()}>Prepare video</Button>}
      <p className={styles.muted}>Your source remains in Media Library.</p></section>}
    {pending ? <p role="status">{recovering ? 'Recovering your review…' : 'Preparing your video…'} You can recover this session after reloading.</p> : !source && !session ? <p>Choose or upload one video, preview it, then prepare it for review.</p> : null}
    {url && <iframe ref={frame} title="Cooked video review" src={url} sandbox="allow-scripts allow-same-origin allow-downloads" referrerPolicy="same-origin"
      className={styles.reviewFrame} style={{ height: frameHeight }} />}
    {session && <div className={styles.tools}>
      <Button className={styles.button} disabled={!session.jobId || disabled || session.saving} onClick={() => void save()}>{saving ? 'Saving…' : 'Save current edit'}</Button>
      <Button className={styles.button} secondary disabled={disabled} onClick={() => void close()}>Close editing session</Button>
      {!url && <Button className={styles.button} secondary disabled={disabled} onClick={() => { if (operation.current) return; setPending(true); setRecovering(true); setMessage(''); void recover(session); }}>Recover session</Button>}
      {frameBusy && <p role="status">Applying your block changes…</p>}
    </div>}
    {session?.saved && <section className={styles.panel}><p>Saved copy · revision {session.savedRevision}. Later review changes are not included until you save again.</p><div className={styles.tools}>
      <Button className={styles.button} disabled={disabled} onClick={() => void composer()}>Use saved copy in composer</Button>
      <Button className={styles.button} secondary onClick={() => { const epoch = generation.current; download.current?.abort(); download.current = new AbortController(); void downloadVideo(session.saved!, download.current.signal).catch(() => { if (live(epoch)) setMessage('Download failed. Open the saved copy in Media Library.'); }); }}>Download saved MP4</Button>
    </div><p>Opens a separate new post for review. Nothing is published automatically.</p></section>}
  </main>;
}
