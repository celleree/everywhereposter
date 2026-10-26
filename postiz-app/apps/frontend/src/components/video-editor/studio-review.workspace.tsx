'use client';
import { useEffect, useRef, useState } from 'react';
import useSWR from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useModals } from '@gitroom/frontend/components/layout/new-modal';
import dayjs from 'dayjs';

// Review only: does not invent an authored plan, start inference or publish.
export function StudioReviewWorkspace({ scope }: { scope: string }) {
  const fetch = useFetch(), modals = useModals();
  const [selected, select] = useState(''), [reviewed, confirm] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
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
  const { data: jobs } = useSWR(scope ? ['studio-jobs', scope] : null, () => read('/media/studio/jobs'), { shouldRetryOnError: false });
  const id = selected || (Array.isArray(jobs) ? jobs[0]?.id : '');
  const { data, mutate } = useSWR(id && scope ? ['studio-result', scope, id] : null, () => read('/media/studio/jobs/' + encodeURIComponent(id)), { shouldRetryOnError: false });
  if (!Array.isArray(jobs) || !jobs.length) return null;
  const ready = data?.id === id && data.technicalStatus === 'PASS' && data.preview;
  const version = data ? [id, data.generation, data.sha256].join(':') : '';
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
  return <section aria-label="Studio results">
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
    </div> : <p role="status">{data?.technicalStatus === 'STALE_NEEDS_VERIFICATION' ? 'This result needs current technical verification before review.' : 'This edit is awaiting its approved plan or worker verification. Refresh to check progress.'}</p>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
