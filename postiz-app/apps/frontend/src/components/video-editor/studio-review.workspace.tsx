'use client';
import { useEffect, useRef, useState } from 'react';
import useSWR from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useModals } from '@gitroom/frontend/components/layout/new-modal';
import dayjs from 'dayjs';
import { MediaBox } from '@gitroom/frontend/components/media/media.component';
import { useMediaDirectory } from '@gitroom/react/helpers/use.media.directory';

// New uploaded/owned source -> evidence -> metered direction -> private review.
// Opening the composer remains a separate deliberate action; nothing publishes.
export function StudioReviewWorkspace({ scope }: { scope: string }) {
  const fetch = useFetch(), modals = useModals();
  const directory = useMediaDirectory();
  const [selected, select] = useState(''), [reviewed, confirm] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [source, setSource] = useState<any>(), [visuals, setVisuals] = useState<string[]>([]), [targets, setTargets] = useState(['instagram']);
  const [brief, setBrief] = useState('Keep my words and add a few clear source-led graphics using my selected supporting visuals.');
  const [framing, setFraming] = useState<any>({ x: .28, y: .28, width: .44, height: .24 }), [framingConfirmed, setFramingConfirmed] = useState(false);
  const [adjusting, setAdjusting] = useState(false), [pendingRequest, setPendingRequest] = useState<any>();
  const drag = useRef<{ x: number; y: number }>(), receiptKey = 'everywhereposter:studio-request:v1:' + scope;
  const sourceGeneration = useRef(0);
  useEffect(() => { try { const raw = localStorage.getItem(receiptKey); if (raw && raw.length < 16384) setPendingRequest(JSON.parse(raw)); } catch {} }, [receiptKey]);
  const active = useRef(true); useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const read = async (url: string) => {
    const r = await fetch(url); if (!r.ok) throw Error('Studio results are unavailable. Your original is unchanged.');
    const value = await r.json();
    if (value.preview === true) {
      const target = new URL(r.url); target.search = ''; target.pathname = target.pathname.replace(/\/$/, '') + '/preview';
      if (target.origin !== window.location.origin) throw Error('Studio requires the application same-origin backend proxy.');
      value.preview = target.toString();
    }
    return value;
  };
  const { data: availability } = useSWR(scope ? ['studio-availability', scope] : null, () => read('/media/studio/status'), { shouldRetryOnError: false });
  const { data: jobs, mutate: refreshJobs } = useSWR(scope ? ['studio-jobs', scope] : null, () => read('/media/studio/jobs'), { shouldRetryOnError: false });
  const id = selected || (Array.isArray(jobs) ? jobs[0]?.id : '');
  const { data, mutate } = useSWR(id && scope ? ['studio-result', scope, id] : null, () => read('/media/studio/jobs/' + encodeURIComponent(id)), {
    shouldRetryOnError: false, refreshInterval: (value: any) => value?.state === 'RUNNING' && value?.phase !== 'NEEDS_VERIFICATION' ? 3000 : 0 });
  const ready = data?.id === id && data.technicalStatus === 'PASS' && data.preview;
  const version = data ? [id, data.generation, data.sha256].join(':') : '';
  const choose = (video: boolean) => modals.openModal({ title: 'Media Library', fullScreen: true, askClose: false,
    closeOnEscape: true, size: 'calc(100% - 80px)', height: 'calc(100% - 80px)',
    children: (close) => <MediaBox {...(video ? { type: 'video' as const } : {})} hideSourceTabs compactPicker closeModal={close}
      setMedia={async items => {
        if (!video) {
          const ids = [...new Set(items.map(i => i.id))];
          if (!ids.length || ids.length > 8 || ids.includes(source?.id)) { setError('Choose one to eight supporting images/videos, separate from the source.'); return; }
          setVisuals(ids); close(); return;
        }
        if (items.length !== 1) { setError('Choose one source video.'); return; }
        const generation = ++sourceGeneration.current;
        try {
          const media = await read('/media/' + encodeURIComponent(items[0].id));
          if (media.id !== items[0].id || media.type !== 'video') throw Error('Choose an available video.');
          if (!active.current || sourceGeneration.current !== generation) return;
          setSource(media); setVisuals([]); setFramingConfirmed(false); setFraming({ x: .28, y: .28, width: .44, height: .24 }); close();
          const prior = await read('/media/studio/framing/' + encodeURIComponent(media.id));
          if (active.current && sourceGeneration.current === generation && prior.framing) { setFraming(prior.framing); setFramingConfirmed(true); }
        } catch { setError('Source details or previous framing could not be loaded.'); }
      }} /> });
  const submit = async (recover = false) => {
    if (busy) return; setBusy(true); setError('');
    try {
      const body = recover ? pendingRequest : { requestKey: crypto.randomUUID(), sourceMediaId: source.id, brollMediaIds: visuals,
        destinations: targets, profile: 'easy-graphics-v1', creative: { brief, framing: { ...framing, confirmed: true, stationary: true, singleSpeaker: true } } };
      // Persist identity before dispatch; uncertain response retries the same body.
      localStorage.setItem(receiptKey, JSON.stringify(body)); setPendingRequest(body);
      const r = await fetch('/media/studio/jobs', { method: 'POST', body: JSON.stringify(body) });
      if (!r.ok) throw Error('The edit request was not confirmed. Recover this same request before starting another.');
      const created = await r.json(); if (typeof created.id !== 'string') throw Error('The edit needs verification.');
      if (!active.current) return; await refreshJobs(); select(created.id); confirm('');
    } catch (e) { if (active.current) setError((e as Error).message); } finally { if (active.current) setBusy(false); }
  };
  const save = async () => {
    if (!ready || reviewed !== version || busy) return;
    setBusy(true); setError('');
    try {
      const r = await fetch('/media/studio/jobs/' + encodeURIComponent(id) + '/review', { method: 'POST',
        body: JSON.stringify({ generation: data.generation, sha256: data.sha256, reviewed: true }) });
      if (!r.ok) throw Error('The reviewed copy could not be confirmed. Refresh this result before retrying.');
      await mutate();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  const composer = async () => {
    if (!data?.outputMediaId || busy) return;
    setBusy(true); setError('');
    try {
      const media = await read('/media/' + encodeURIComponent(data.outputMediaId));
      if (media.id !== data.outputMediaId || media.path !== data.savedPath || media.type !== 'video') throw Error('The saved video is no longer available.');
      const accounts = await read('/integrations/list');
      if (!Array.isArray(accounts.integrations) || accounts.integrations.some((a: any) => typeof a?.id !== 'string')) throw Error('Connected accounts are unavailable.');
      const { AddEditModal } = await import('@gitroom/frontend/components/new-launch/add.edit.modal');
      if (!active.current) return;
      modals.openModal({ id: 'add-edit-modal', closeOnClickOutside: false, removeLayout: true, closeOnEscape: false,
        withCloseButton: false, askClose: true, fullScreen: true, size: '80%', title: '',
        classNames: { modal: 'w-[100%] max-w-[1400px] text-textColor' },
        children: <AddEditModal onlyValues={[{ content: '', image: [{ id: media.id, path: media.path }] }]}
          allIntegrations={accounts.integrations} integrations={accounts.integrations} date={dayjs()} reopenModal={() => {}} mutate={() => {}} /> });
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  if (!availability?.enabled && (!Array.isArray(jobs) || !jobs.length)) return null;
  return <section aria-label="Studio results">
    {availability?.enabled && <div>
      <h2>Create a Studio edit</h2>
      <p>Beta: one stationary speaker, portrait CFR30 original, up to60seconds/100MB and720x1280. Choose supporting visuals. Creative direction uses prepaid AI credits; review the result before saving or posting. Moving/multiple speakers need adjustment; there is no automatic tracking.</p>
      <button disabled={busy} onClick={() => choose(true)}>Upload or choose source</button>
      <button disabled={busy || !source} onClick={() => choose(false)}>Choose supporting visuals ({visuals.length}/8)</button>
      {source && <>
        <div style={{ position: 'relative', aspectRatio: '9 / 16', maxWidth: 320 }}>
          <video key={source.id} controls playsInline src={directory.set(source.path)} aria-label="Original video for speaker framing" style={{ width: '100%', height: '100%' }} />
          <div style={{ position: 'absolute', inset: 0, pointerEvents: adjusting ? 'auto' : 'none', touchAction: 'none' }}
            onPointerDown={e => { const r = e.currentTarget.getBoundingClientRect(); drag.current = { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height }; e.currentTarget.setPointerCapture(e.pointerId); }}
            onPointerUp={e => {
              const r = e.currentTarget.getBoundingClientRect(), start = drag.current; if (!start) return;
              const x = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), y = Math.max(0, Math.min(1, (e.clientY - r.top) / r.height));
              setFraming({ x: Math.min(x, start.x), y: Math.min(y, start.y), width: Math.abs(x - start.x), height: Math.abs(y - start.y) });
              setFramingConfirmed(false); setAdjusting(false); drag.current = undefined;
            }}>
            <div aria-label="Speaker framing guide, not detected" style={{ position: 'absolute', border: '3px solid #86efac', boxSizing: 'border-box', left: framing.x * 100 + '%', top: framing.y * 100 + '%', width: framing.width * 100 + '%', height: framing.height * 100 + '%' }} />
          </div>
        </div>
        <button disabled={busy} onClick={() => { setAdjusting(!adjusting); setFramingConfirmed(false); }}>Adjust speaker area</button>
        <p>{adjusting ? 'Drag a rectangle around the speaker. Then watch the clip and confirm below.' : framing.sourceSha256 ? 'Reusing your source-bound framing observation; adjust it if needed.' : 'The outline is a guide, not detection. Adjust it if it does not contain your speaker.'}</p>
        <label><input type="checkbox" checked={framingConfirmed} onChange={e => setFramingConfirmed(e.target.checked)} />I checked that this outlined area contains one stationary speaker throughout the clip.</label>
      </>}
      <label>Direction <textarea maxLength={1000} value={brief} disabled={busy} onChange={e => setBrief(e.target.value)} /></label>
      <fieldset><legend>Framing destinations</legend>{['instagram', 'facebook', 'threads', 'tiktok', 'youtube', 'linkedin', 'x', 'pinterest', 'reddit', 'dribbble'].map(p =>
        <label key={p}><input type="checkbox" checked={targets.includes(p)} disabled={busy} onChange={e => setTargets(v => e.target.checked ? [...v, p] : v.filter(x => x !== p))} />{p}</label>)}</fieldset>
      <button disabled={busy || !!pendingRequest || !source || !visuals.length || !targets.length || !framingConfirmed || framing.width < .05 || framing.height < .05 || !brief.trim()} onClick={() => void submit()}>Create Studio edit (uses AI credits)</button>
      {pendingRequest && <><button disabled={busy} onClick={() => void submit(true)}>Recover last edit request</button>
        <button disabled={busy} onClick={() => { try { localStorage.removeItem(receiptKey); setPendingRequest(undefined); } catch { setError('The prior request could not be cleared.'); } }}>Start another edit (new AI request)</button></>}
    </div>}
    {Array.isArray(jobs) && jobs.length > 0 && <div>
    <h2>Review your Studio edit</h2>
    <label>Recent result <select value={id} disabled={busy} onChange={e => { select(e.target.value); confirm(''); setError(''); }}>
      {jobs.map((j: any) => <option key={j.id} value={j.id}>{j.id.slice(0, 8)} — {j.state}</option>)}
    </select></label>
    <button disabled={busy} onClick={() => { confirm(''); void mutate(); }}>Refresh result</button>
    {ready ? <div key={data.sha256}>
      <p>Technical checks passed. Watch and listen before saving. Your original is unchanged.</p>
      <video controls playsInline preload="metadata" aria-label="Studio video to review" src={data.preview} style={{ maxWidth: '100%', maxHeight: 600 }} />
      {data.limitations?.map((text: string) => <p key={text}>{text}</p>)}
      <p>Selected framing profiles: {data.safeZoneProfiles?.join(', ')}. Provisional and ad-derived profiles are guidance, not a guarantee for every platform screen.</p>
      {data.outputMediaId ? <><p>Reviewed copy saved in Media Library.</p><button disabled={busy} onClick={() => void composer()}>Use in composer</button></> : <>
        <label><input type="checkbox" checked={reviewed === version} onChange={e => confirm(e.target.checked ? version : '')} />I have watched and listened to this version and approve saving this copy.</label>
        <button disabled={reviewed !== version || busy} onClick={() => void save()}>Save reviewed copy</button>
      </>}
      <p>Opening the composer does not publish. Review your destinations and post there.</p>
    </div> : <p role="status">{data?.message || (data?.technicalStatus === 'STALE_NEEDS_VERIFICATION' ? 'This result needs current technical verification before review.' : 'Preparing source evidence, generated direction or worker verification. Your original is unchanged.')}</p>}
    {data?.state === 'RUNNING' && <button disabled={busy} onClick={async () => {
      setBusy(true); setError(''); try { const r = await fetch('/media/studio/jobs/' + encodeURIComponent(id) + '/resume', { method: 'POST' });
        if (!r.ok) throw Error('This edit could not resume safely. No replacement request was created.'); await mutate();
      } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
    }}>Check and resume safely</button>}
    </div>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
