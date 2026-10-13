'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useSWRConfig } from 'swr';

type Status = { eligible: boolean; reason?: string; pageName?: string; releaseId?: string; permalink?: string; message?: string; revision?: number; deleted?: boolean; pending?: boolean };
export function FacebookPublishedManagement({ postId }: { postId: string }) {
  const fetch = useFetch();
  const { mutate } = useSWRConfig();
  const [status, setStatus] = useState<Status>();
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const guard = useRef(false);
  const deleteButton = useRef<HTMLButtonElement>(null);
  const epoch = useRef(0);
  const request = useCallback(async (method = 'GET', body?: object, reconcile = false) => {
    const response = await fetch(`/posts/${encodeURIComponent(postId)}/facebook-published${reconcile ? '/reconcile' : ''}`, {
      method, ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(typeof data.message === 'string' ? data.message : 'Unable to confirm the Facebook result.');
    return data as Status;
  }, [fetch, postId]);
  useEffect(() => {
    const generation = ++epoch.current;
    setStatus(undefined); setMessage(''); setError(''); setConfirm(false); setBusy(false); guard.current = false;
    request().then((data) => { if (generation === epoch.current) { setStatus(data); setMessage(data.message || ''); } })
      .catch((error) => { if (generation === epoch.current) setError(error.message); });
    return () => { epoch.current++; };
  }, [request]);
  const perform = async (action: 'edit' | 'delete' | 'reconcile') => {
    if (guard.current) return;
    guard.current = true; setBusy(true); setError('');
    const generation = epoch.current;
    try {
      const data = await request('POST', action === 'reconcile' ? undefined : {
        action, revision: status?.revision, ...(action === 'edit' ? { message } : {}),
      }, action === 'reconcile');
      if (generation !== epoch.current) return;
      setStatus(data); setMessage(data.message || ''); setConfirm(false);
      // Details, calendar, lists and platform-media keys use different formats.
      await mutate(() => true);
    } catch (error) {
      if (generation !== epoch.current) return;
      setError(error instanceof Error ? error.message : 'Unable to confirm the Facebook result.');
      // Refresh only status: retain the requested text while reconciling.
      const data = await request().catch(() => undefined);
      if (data && generation === epoch.current) setStatus(data);
    } finally { if (generation === epoch.current) { guard.current = false; setBusy(false); } }
  };
  return <section aria-label="Facebook text post management" className="flex min-w-0 flex-col gap-3 rounded-lg border border-newBorder p-4">
    <h2 className="font-semibold">Facebook text/feed post</h2>
    {error && <p role="alert" className="break-words text-red-400">{error}</p>}
    {!status && !error && <p role="status">Loading Facebook post actions…</p>}
    {status && !status.eligible && <p>{status.reason}</p>}
    {status?.eligible && <>
      <p className="break-words">Page: {status.pageName} · Post: {status.releaseId}</p>
      <a href={status.permalink} target="_blank" rel="noopener noreferrer" className="underline">Open this post on Facebook</a>
      {status.deleted ? <p role="status">Deleted on Facebook.</p> : <>
        <label htmlFor={`facebook-message-${postId}`}>Post message</label>
        <textarea id={`facebook-message-${postId}`} value={message} onChange={(event) => setMessage(event.target.value)}
          disabled={busy || status.pending} maxLength={63206} rows={5} className="w-full min-w-0 rounded border border-newBorder bg-newBgColor p-3" />
        <p>Only text can change. Links, media, account selection and comments are not editable here.</p>
        {status.pending ? <>
          <p role="status">The previous operation needs confirmation. Publishing again is blocked.</p>
          <button disabled={busy} onClick={() => perform('reconcile')} className="rounded bg-btnSimple p-3">Check result</button>
        </> : <>
          <button disabled={busy || !message.trim() || message === status.message} onClick={() => perform('edit')} className="rounded bg-btnSimple p-3">Save Facebook message</button>
          <button ref={deleteButton} disabled={busy} onClick={() => setConfirm(true)} className="rounded border border-newBorder p-3">Delete from Facebook</button>
        </>}
        {confirm && <div role="alertdialog" onKeyDown={(event) => { if (event.key === 'Escape' && !busy) { setConfirm(false); deleteButton.current?.focus(); } }} aria-labelledby={`facebook-delete-${postId}`} className="rounded border border-red-400 p-3">
          <p id={`facebook-delete-${postId}`} className="break-words">Permanently delete post {status.releaseId} from Facebook Page {status.pageName}? This removes the remote post, not just its local record.</p>
          <button autoFocus disabled={busy} onClick={() => { setConfirm(false); deleteButton.current?.focus(); }} className="p-3">Cancel</button>
          <button disabled={busy} onClick={() => perform('delete')} className="p-3 text-red-400">Confirm Facebook deletion</button>
        </div>}
      </>}
    </>}
  </section>;
}
