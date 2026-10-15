'use client';
import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useUser } from '../layout/user.context';
import { useVariables } from '@gitroom/react/helpers/variable.context';
import { useLaunchStore } from '../new-launch/store';
import { ResumableTransfers, Transfer } from './resumable-transfer';

const TransfersContext = createContext<ResumableTransfers | null>(null);
export const useResumableTransfers = () => useContext(TransfersContext);
const TransferViewContext = createContext<{
  items: Transfer[];
  actionError: string;
  setActionError: (message: string) => void;
  optIntoQuickUpload: (item: Transfer) => Promise<void>;
} | null>(null);

function RetryUpload({ transfers, item }: { transfers: ResumableTransfers; item: Transfer }) {
  const input = useRef<HTMLInputElement>(null);
  return <>
    <button type="button" className="!min-h-[44px] px-[8px]" onClick={() => {
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
  const [items, setItems] = useState<Transfer[]>([]);
  // Capture organization; stop using the old controller if the user's context changes.
  const transfers = useMemo(() => new ResumableTransfers(fetch, setItems, user?.orgId || ''), [fetch, user?.orgId]);
  const local = storageProvider === 'local' && !transloadit?.length;
  useEffect(() => {
    transfers.activate();
    setItems([]);
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
  return <TransfersContext.Provider value={transfers}>
    <TransferViewContext.Provider value={{ items, actionError, setActionError, optIntoQuickUpload }}>
      {children}
    </TransferViewContext.Provider>
  </TransfersContext.Provider>;
}

// The layout keeps the controller alive; each upload surface owns its presentation.
export function UploadTransfers() {
  const transfers = useResumableTransfers();
  const view = useContext(TransferViewContext);
  if (!transfers || !view || !view.items.length) return null;
  const { items, actionError, setActionError, optIntoQuickUpload } = view;
  return <section aria-label="Video transfers" className="mt-[16px] min-w-0 text-newTextColor">
      {actionError && <p role="alert">{actionError}</p>}
      <p className="text-[12px]">You can browse Everywhere Poster while uploading. Keep this website open.</p>
      {items.map(item => <div key={item.id} className="mt-[8px] border-t border-newBorder pt-[8px]">
        <p className="break-all text-[13px] font-[600]">{item.name}</p>
        <p role="status" className="text-[12px]">{item.state}</p>
        <progress aria-label={`Upload progress for ${item.name}`} value={item.sent} max={Math.max(1, item.bytes)} className="my-[8px] block h-[8px] w-full accent-btnPrimary" />
        {item.session?.quickIntent ? <div aria-label="Quick Upload progress">
          <p role="status">Quick Upload: {({ WAITING: 'Uploading', PROCESSING: 'Processing', GENERATING: 'Processing', GENERATED: 'Processing', PUBLISHING: 'Publishing', FAILED: 'Failed', CANCELLED: 'Skipped' } as Record<string, string>)[item.session.quickIntent.status] || (item.session.quickIntent.results.some(result => result.state === 'Failed') ? 'Failed' : item.session.quickIntent.results.some(result => result.state === 'Published') ? 'Published' : 'Skipped')}</p>
          {item.session.quickIntent.message && <p>{item.session.quickIntent.message}</p>}
          {item.session.quickIntent.results.map(result => <p key={result.integrationId}>{result.name}: {result.state}{result.reason ? ` — ${result.reason}` : ''}</p>)}
          {item.session.quickIntent.status === 'WAITING' && <button className="!min-h-[44px]" onClick={() => void transfers.cancelQuickUpload(item.id).catch(error => setActionError(error.message))}>Cancel Quick Upload</button>}
        </div> : transfers.durableQuickUploadEnabled && <div>
          <p className="text-[12px]">Quick Upload generates captions and publishes to eligible connected accounts without individual review. Accounts needing settings or review are skipped.</p>
          <button className="!min-h-[44px]" disabled={item.quickRequested && !item.quickError} onClick={() => void (item.quickError ? transfers.retryQuickUpload(item.id) : optIntoQuickUpload(item)).catch(error => setActionError(error.message))}>{item.quickRequested ? 'Confirm saved Quick Upload choice' : 'Quick Upload without individual review'}</button>
          {item.quickRequested && !item.quickError && <p>Waiting for server confirmation of your choice.</p>}
        </div>}
        {item.quickError && <p role="alert">{item.quickError}</p>}
        {item.state === 'Transfer complete' ? <p>Safe to leave. Your video is saved in Media Library.</p> : <>
          {item.error && <p role="alert">{item.error}</p>}
        {item.state !== 'Uploading' && <RetryUpload transfers={transfers} item={item} />}
          <button className="!min-h-[44px] px-[8px]" onClick={() => void transfers.cancel(item.id).catch(error => setActionError(error.message))}>Cancel upload</button>
        </>}
      </div>)}
  </section>;
}
