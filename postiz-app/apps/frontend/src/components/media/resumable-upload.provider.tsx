'use client';
import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useUser } from '../layout/user.context';
import { useVariables } from '@gitroom/react/helpers/variable.context';
import { useLaunchStore } from '../new-launch/store';
import { ResumableTransfers, Transfer } from './resumable-transfer';

const TransfersContext = createContext<ResumableTransfers | null>(null);
export const useResumableTransfers = () => useContext(TransfersContext);

function RetryUpload({ transfers, item }: { transfers: ResumableTransfers; item: Transfer }) {
  const input = useRef<HTMLInputElement>(null);
  return <>
    <button type="button" className="min-h-[44px] px-[8px]" onClick={() => {
      if (transfers.hasFile(item.id)) void transfers.resume(item.id).catch(() => {});
      else input.current?.click();
    }}>Retry upload</button>
    {!transfers.hasFile(item.id) && <p className="text-[12px]">Select the original video to resume saved progress.</p>}
    <input hidden ref={input} aria-label={`Resume ${item.name}`} type="file" accept=".mp4,.mov,video/mp4,video/quicktime" onChange={event => {
      const file = event.target.files?.[0];
      if (file) void transfers.resume(item.id, file).catch(() => {});
      event.target.value = '';
    }} />
  </>;
}

export function ResumableUploadProvider({ children }: { children: React.ReactNode }) {
  const fetch = useFetch();
  const user = useUser();
  const { storageProvider, transloadit } = useVariables();
  const [actionError, setActionError] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [items, setItems] = useState<Transfer[]>([]);
  // Capture organization; stop using the old controller if the user's context changes.
  const transfers = useMemo(() => new ResumableTransfers(fetch, setItems, user?.orgId || ''), [fetch, user?.orgId]);
  const local = storageProvider === 'local' && !transloadit?.length;
  useEffect(() => {
    transfers.activate();
    setItems([]);
    setExpanded(false);
    if (local) void transfers.refresh().catch(() => {});
    const interval = local ? setInterval(() => { void transfers.refresh().catch(() => {}); }, 10_000) : undefined;
    return () => { clearInterval(interval); transfers.dispose(); };
  }, [transfers, local]);
  const optIntoQuickUpload = async (item: Transfer) => {
    const response = await fetch('/integrations/list');
    if (!response.ok) throw new Error('Connected accounts could not be checked safely.');
    const accounts = (await response.json()).integrations;
    if (!Array.isArray(accounts) || !accounts.length) throw new Error('Connect accounts or use Customize.');
    const settings = new Map(useLaunchStore.getState().selectedIntegrations.map(selected => [selected.integration.id, selected.settings]));
    // Snapshot explicit settings. The server skips destinations needing additional choices.
    await transfers.optIntoQuickUpload(item.id, { confirmNoIndividualReview: true, destinations: accounts.map(account => ({ id: account.id, settings: { ...(account.identifier === 'x' ? { who_can_reply_post: 'everyone' } : account.identifier.startsWith('instagram') ? { post_type: 'reel', post_type_explicit: false } : {}), ...settings.get(account.id) } })) });
  };
  const problem = [...items].reverse().find(item => item.error || item.quickError);
  const visibleError = problem ? `${problem.name}: ${problem.error || problem.quickError}` : actionError;
  const active = items.find(item => item.state !== 'Transfer complete');
  return <TransfersContext.Provider value={transfers}>
    {children}
    {items.length > 0 && <aside aria-label="Video transfers" className="fixed bottom-[90px] right-[12px] z-[95] max-w-[calc(100vw-24px)] rounded border border-newBorder bg-newBgColorInner text-newTextColor shadow-menu">
      <button type="button" aria-expanded={expanded} onClick={() => setExpanded(value => !value)} className="min-h-[44px] px-[12px] text-[13px] font-[600]">
        {expanded ? 'Hide video transfers' : `Show video transfers (${items.length})${active ? ` — ${active.state}` : ''}`}
      </button>
      {!expanded && visibleError && <p role="alert" className="max-w-[340px] px-[12px] pb-[8px] text-[12px]">{visibleError}</p>}
      {expanded && <div className="max-h-[35vh] w-[340px] max-w-[calc(100vw-24px)] overflow-auto p-[12px]">
      {actionError && <p role="alert">{actionError}</p>}
      <p className="text-[12px]">You can navigate within this app. Closing the browser pauses unfinished transfers; return and select the original video to resume.</p>
      {items.map(item => <div key={item.id} className="mt-[8px] border-t border-newBorder pt-[8px]">
        <p className="break-all">{item.name}</p><p role="status">{item.state} — {Math.floor(item.sent / Math.max(1, item.bytes) * 100)}%</p>
        {item.session?.quickIntent ? <div aria-label="Quick Upload progress">
          <p role="status">Quick Upload: {({ WAITING: 'Uploading', PROCESSING: 'Processing', GENERATING: 'Processing', GENERATED: 'Processing', PUBLISHING: 'Publishing', FAILED: 'Failed', CANCELLED: 'Skipped' } as Record<string, string>)[item.session.quickIntent.status] || (item.session.quickIntent.results.some(result => result.state === 'Failed') ? 'Failed' : item.session.quickIntent.results.some(result => result.state === 'Published') ? 'Published' : 'Skipped')}</p>
          {item.session.quickIntent.message && <p>{item.session.quickIntent.message}</p>}
          {item.session.quickIntent.results.map(result => <p key={result.integrationId}>{result.name}: {result.state}{result.reason ? ` — ${result.reason}` : ''}</p>)}
          {item.session.quickIntent.status === 'WAITING' && <button className="min-h-[44px]" onClick={() => void transfers.cancelQuickUpload(item.id).catch(error => setActionError(error.message))}>Cancel Quick Upload</button>}
        </div> : transfers.durableQuickUploadEnabled && <div>
          <p className="text-[12px]">Quick Upload generates captions and publishes to eligible connected accounts without individual review. Accounts needing settings or review are skipped.</p>
          <button className="min-h-[44px]" disabled={item.quickRequested && !item.quickError} onClick={() => void (item.quickError ? transfers.retryQuickUpload(item.id) : optIntoQuickUpload(item)).catch(error => setActionError(error.message))}>{item.quickRequested ? 'Confirm saved Quick Upload choice' : 'Quick Upload without individual review'}</button>
          {item.quickRequested && !item.quickError && <p>Waiting for server confirmation of your choice.</p>}
        </div>}
        {item.quickError && <p role="alert">{item.quickError}</p>}
        {item.state === 'Transfer complete' ? <p>Safe to leave. Your video is saved in Media Library.</p> : <>
          {item.error && <p role="alert">{item.error}</p>}
        {item.state === 'Uploading' ? <button className="min-h-[44px] px-[8px]" onClick={() => transfers.pause(item.id)}>Pause</button> : <RetryUpload transfers={transfers} item={item} />}
          <button className="min-h-[44px] px-[8px]" onClick={() => void transfers.cancel(item.id).catch(error => setActionError(error.message))}>Cancel upload</button>
        </>}
      </div>)}
      </div>}
    </aside>}
  </TransfersContext.Provider>;
}
