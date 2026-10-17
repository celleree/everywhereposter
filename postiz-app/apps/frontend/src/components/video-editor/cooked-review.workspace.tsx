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
  const [session, setSession] = useState<Session>(); const current = useRef<Session | undefined>(undefined);
  const [url, setUrl] = useState(''), [pending, setPending] = useState(false), [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false), [opening, setOpening] = useState(false);
  const scopeKey = useRef(key);
  const active = useRef(true), timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const choosing = useRef(false), download = useRef<AbortController | undefined>(undefined);
  const write = (s: Session) => { localStorage.setItem(key, JSON.stringify(s)); current.current = s; setSession(s); };
  const base = (s: Session) => '/media/cooked/' + encodeURIComponent(s.sourceId);
  const accept = (s: Session, response: Response, body: { jobId?: string; status?: string }) => {
    if (!active.current || scopeKey.current !== key) return false;
    if (body.status === 'failed') throw new Error('This edit could not finish. Close the session and choose the source again.');
    if (body.status !== 'ready' || !body.jobId || !UUID.test(body.jobId)) return false;
    const next = { ...s, jobId: body.jobId }; write(next);
    const target = new URL(response.url); target.search = ''; target.pathname = target.pathname.replace(/\/find$/, '').replace(/\/$/, '') + '/' + body.jobId + '/review';
    if (target.origin !== window.location.origin) throw new Error('The editor requires the application’s same-origin backend proxy.');
    setUrl(target.toString()); setPending(false); return true;
  };
  const recover = async (s: Session) => {
    try {
      const response = await fetch(base(s) + '/find?request=' + s.requestId);
      if (!active.current || scopeKey.current !== key || current.current?.requestId !== s.requestId) return;
      if (!response.ok) throw new Error('This editing session is unavailable or expired. Saved copies remain in Media Library.');
      if (!accept(s, response, await response.json())) timer.current = setTimeout(() => void recover(s), 3000);
    } catch (e) { if (active.current && scopeKey.current === key) { setPending(false); setMessage((e as Error).message); } }
  };
  useEffect(() => {
    active.current = true; scopeKey.current = key; current.current = undefined;
    setSession(undefined); setUrl(''); setPending(false); setMessage(''); setSaving(false); setOpening(false);
    try {
      const raw = localStorage.getItem(key);
      if (raw) {
        if (raw.length > 4096) throw new Error(); const s = JSON.parse(raw);
        if (!s || !/^[\w-]{1,128}$/.test(s.sourceId) || !UUID.test(s.requestId)) throw new Error();
        if (s.saved && !isVideo(s.saved, s.saved.id)) throw new Error();
        current.current = s; setSession(s); setPending(true); void recover(s);
        if (s.saving) setMessage('A copy may already have been saved. Check Media Library before saving again.');
      }
    } catch { setMessage('The saved editing session could not be recovered. Choose a video deliberately to start again.'); }
    return () => { active.current = false; clearTimeout(timer.current); download.current?.abort(); };
  }, [key]);
  const close = async () => {
    const s = current.current; if (!s || pending) return;
    const response = await fetch(base(s) + '/request/' + s.requestId, { method: 'DELETE' });
    if (!response.ok && response.status !== 404) throw new Error('The session could not be closed. Try again after the current edit finishes.');
    localStorage.removeItem(key); clearTimeout(timer.current); current.current = undefined; setSession(undefined); setUrl('');
  };
  const choose = () => modals.openModal({ title: 'Media Library', contentClassName: 'upload-media-picker', askClose: false,
    closeOnEscape: true, fullScreen: true, size: 'calc(100% - 80px)', height: 'calc(100% - 80px)',
    children: (closePicker) => <MediaBox type="video" hideSourceTabs compactPicker closeModal={closePicker} setMedia={(items) => {
      if (items.length !== 1 || !/^[\w-]{1,128}$/.test(String(items[0].id))) { setMessage('Choose exactly one video.'); return; }
      void (async () => {
        if (choosing.current) return; choosing.current = true;
        try {
          if (current.current) await close();
          const s: Session = { sourceId: String(items[0].id), requestId: crypto.randomUUID() };
          write(s); setPending(true); setMessage('');
          const response = await fetch(base(s), { method: 'POST', body: JSON.stringify({ requestId: s.requestId }) });
          if (!active.current || scopeKey.current !== key || current.current?.requestId !== s.requestId) return;
          if (!response.ok) { setPending(false); throw new Error(response.status === 429 ? 'Another editing session is open. Try again later.' : 'The edit outcome is uncertain. Recover the session before starting another edit.'); }
          if (!accept(s, response, await response.json())) void recover(s);
        } catch (e) { if (active.current && scopeKey.current === key) { setPending(false); setMessage((e as Error).message); } }
        finally { choosing.current = false; }
      })();
    }} /> });
  const save = async () => {
    const s = current.current; if (!s?.jobId || saving || s.saving) return;
    setSaving(true); setMessage('');
    try {
      const stateResponse = await fetch(base(s) + '/' + s.jobId + '/state');
      if (!stateResponse.ok) throw new Error('The current edit could not be checked.');
      const state = await stateResponse.json(); if (state.busy) throw new Error('Finish applying your changes before saving.');
      write({ ...s, saving: true });
      const response = await fetch(base(s) + '/' + s.jobId + '/output', { method: 'POST', body: JSON.stringify({ revision: state.revision }) });
      if (!response.ok) {
        if ([400, 401, 403, 404, 409, 422, 429].includes(response.status)) write({ ...s, saving: false });
        throw new Error('The copy could not be confirmed. Check Media Library before saving again.');
      }
      const body = await response.json(); if (!isVideo(body.outputMedia, body.outputMedia?.id)) throw new Error('The saved copy could not be confirmed.');
      if (active.current && scopeKey.current === key) write({ ...s, saving: false, saved: body.outputMedia, savedRevision: body.revision });
    } catch (e) { if (active.current && scopeKey.current === key) setMessage((e as Error).message); }
    finally { if (active.current && scopeKey.current === key) setSaving(false); }
  };
  const composer = async () => {
    const output = current.current?.saved; if (!output || opening) return; setOpening(true); setMessage('');
    try {
      const r = await fetch('/media/' + encodeURIComponent(output.id)); const confirmed = r.ok ? await r.json() : null;
      if (!isVideo(confirmed, output.id) || confirmed.path !== output.path) throw new Error('The saved video is unavailable.');
      const accounts = await fetch('/integrations/list'); const integrations = accounts.ok ? (await accounts.json()).integrations : null;
      if (!Array.isArray(integrations) || integrations.some(item => typeof item?.id !== 'string')) throw new Error('Connected accounts could not be loaded.');
      const { AddEditModal } = await import('@gitroom/frontend/components/new-launch/add.edit.modal');
      if (!active.current || scopeKey.current !== key) return;
      modals.openModal({ id: 'add-edit-modal', closeOnClickOutside: false, removeLayout: true, closeOnEscape: false, withCloseButton: false,
        askClose: true, fullScreen: true, size: '80%', title: '', classNames: { modal: 'w-[100%] max-w-[1400px] text-textColor' },
        children: <AddEditModal onlyValues={[{ content: '', image: [{ id: confirmed.id, path: confirmed.path }] }]} allIntegrations={integrations}
          integrations={integrations} date={dayjs()} reopenModal={() => {}} mutate={() => {}} /> });
    } catch (e) { if (active.current && scopeKey.current === key) setMessage((e as Error).message); }
    finally { if (active.current && scopeKey.current === key) setOpening(false); }
  };
  return <main className={styles.workspace} aria-label="Video Editor workspace">
    <header className={styles.header}><div><h2>Edit your video by its words</h2><p>Select words to cut or restore, then Apply. Your original stays unchanged.</p></div>
      <Button disabled={pending || saving || opening} onClick={choose}>Choose video</Button></header>
    <p className={styles.notice}>English speech · MP4 or MOV with audio · Up to 60 seconds and 100 MB · Sessions expire after 15 idle minutes. Saved copies stay in Media Library.</p>
    {message && <p role="alert">{message}</p>}
    {pending ? <p role="status">Transcribing and preparing your edit… You can recover this session after reloading.</p> : !session ? <p>Choose or upload one video to start automatic transcription.</p> : null}
    {url && <iframe title="Word-level video editor" src={url} sandbox="allow-scripts allow-same-origin allow-downloads" referrerPolicy="same-origin"
      style={{ width: '100%', height: '85dvh', minHeight: 640, border: '1px solid var(--new-table-border)', borderRadius: 12 }} />}
    {session && <div className={styles.tools}>
      <Button disabled={!session.jobId || pending || saving || session.saving} onClick={() => void save()}>{saving ? 'Saving…' : 'Save current edit'}</Button>
      <Button secondary disabled={pending || saving || opening} onClick={() => void close().catch(e => setMessage(e.message))}>Close editing session</Button>
      {!url && <Button secondary disabled={pending} onClick={() => { setPending(true); void recover(session); }}>Recover session</Button>}
    </div>}
    {session?.saved && <section className={styles.panel}><p>Saved revision {session.savedRevision} · Your original remains unchanged.</p><div className={styles.tools}>
      <Button disabled={opening} onClick={() => void composer()}>Use in composer</Button>
      <Button secondary onClick={() => { download.current?.abort(); download.current = new AbortController(); void downloadVideo(session.saved!, download.current.signal).catch(() => { if (active.current && scopeKey.current === key) setMessage('Download failed. Open the saved copy in Media Library.'); }); }}>Download MP4</Button>
    </div><p>Opens a separate new post for review. Nothing is published automatically.</p></section>}
  </main>;
}
