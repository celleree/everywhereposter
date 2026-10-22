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
  optIntoQuickUpload: (item: Transfer) => Promise<void>;
  errors: Record<string, { message: string; cancellation: boolean } | undefined>;
  pending: Record<string, boolean>;
  busy: React.MutableRefObject<Set<string>>;
  action: (id: string, run: () => Promise<void>, cancellation?: boolean) => Promise<void>;
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
  const [errors, setErrors] = useState<Record<string, { message: string; cancellation: boolean } | undefined>>({});
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const busy = useRef(new Set<string>());
  const action = async (id: string, run: () => Promise<void>, cancellation = false) => {
    if (busy.current.has(id)) return;
    busy.current.add(id);
    setErrors(value => ({ ...value, [id]: undefined }));
    setPending(value => ({ ...value, [id]: true }));
    try { await run(); }
    catch (error) { setErrors(value => ({ ...value, [id]: { message: (error as Error).message, cancellation } })); }
    finally { busy.current.delete(id); setPending(value => ({ ...value, [id]: false })); }
  };
  const [items, setItems] = useState<Transfer[]>([]);
  // Capture organization; stop using the old controller if the user's context changes.
  const transfers = useMemo(() => new ResumableTransfers(fetch, setItems, user?.orgId || ''), [fetch, user?.orgId]);
  const local = storageProvider === 'local' && !transloadit?.length;
  useEffect(() => {
    transfers.activate();
    setItems([]); setErrors({}); setPending({}); busy.current.clear();
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
    <TransferViewContext.Provider value={{ items, optIntoQuickUpload, errors, pending, busy, action }}>
      {children}
    </TransferViewContext.Provider>
  </TransfersContext.Provider>;
}

// Only the composer calls this with media rendered from its attached state.
export function useDismissAttachedTransfers(media: { id: string }[]) {
  const transfers = useResumableTransfers();
  const view = useContext(TransferViewContext);
  useEffect(() => {
    const protectedIds = new Set(view?.busy.current);
    for (const id of Object.keys(view?.errors || {})) if (view?.errors[id]) protectedIds.add(id);
    transfers?.dismissAttached(new Set(media.map(item => item.id)), protectedIds);
  }, [transfers, view?.items, view?.pending, view?.errors, media]);
}

// The layout keeps the controller alive; each upload surface owns its presentation.
export function UploadTransfers() {
  const transfers = useResumableTransfers();
  const view = useContext(TransferViewContext);
  if (!transfers || !view || !view.items.length) return null;
  const { items, optIntoQuickUpload, errors, pending, busy, action } = view;
  // Ordinary completed transfers are history, not active upload work. Preserve
  // pending choices, errors and Quick Upload results in the visible list.
  const completed = items.filter(item => item.state === 'Transfer complete'
    && !item.session?.quickIntent && !item.quickRequested && !item.quickError
    && !errors[item.id] && !pending[item.id] && transfers.canDismiss(item));
  const completedIds = new Set(completed.map(item => item.id));
  const renderTransfer = (item: Transfer) => (
<div key={item.id} className="mt-[8px] border-t border-newBorder pt-[8px]">
        {errors[item.id] && !(errors[item.id]?.cancellation && item.state === 'Transfer complete') && <p role="alert">{errors[item.id]?.message}</p>}
        <p className="break-all text-[13px] font-[600]">{item.name}</p>
        <p role="status" className="text-[12px]">{item.state}</p>
        <progress aria-label={`Upload progress for ${item.name}`} value={item.sent} max={Math.max(1, item.bytes)} className="my-[8px] block h-[8px] w-full accent-btnPrimary" />
        {item.session?.quickIntent ? <div aria-label="Quick Upload progress">
          <p role="status">Quick Upload: {({ WAITING: 'Uploading', PROCESSING: 'Processing', GENERATING: 'Processing', GENERATED: 'Processing', PUBLISHING: 'Publishing', FAILED: 'Failed', CANCELLED: 'Skipped' } as Record<string, string>)[item.session.quickIntent.status] || (item.session.quickIntent.results.some(result => result.state === 'Failed') ? 'Failed' : item.session.quickIntent.results.some(result => result.state === 'Published') ? 'Published' : 'Skipped')}</p>
          {item.session.quickIntent.message && <p>{item.session.quickIntent.message}</p>}
          {item.session.quickIntent.results.map(result => <p key={result.integrationId}>{result.name}: {result.state}{result.reason ? ` — ${result.reason}` : ''}</p>)}
          {item.session.quickIntent.status === 'WAITING' && <button className="!min-h-[44px]" disabled={pending[item.id]} onClick={() => void action(item.id, () => transfers.cancelQuickUpload(item.id))}>Cancel Quick Upload</button>}
        </div> : transfers.durableQuickUploadEnabled && <div>
          <p className="text-[12px]">Quick Upload generates captions and publishes to eligible connected accounts without individual review. Accounts needing settings or review are skipped.</p>
          <button className="!min-h-[44px]" disabled={pending[item.id] || (item.quickRequested && !item.quickError)} onClick={() => void action(item.id, () => item.quickError ? transfers.retryQuickUpload(item.id) : optIntoQuickUpload(item))}>{item.quickRequested ? 'Confirm saved Quick Upload choice' : 'Quick Upload without individual review'}</button>
          {item.quickRequested && !item.quickError && <p>Waiting for server confirmation of your choice.</p>}
        </div>}
        {item.quickError && <p role="alert">{item.quickError}</p>}
        {item.state === 'Transfer complete' ? transfers.canDismiss(item) && <button type="button" className="!min-h-[44px] px-[8px]" disabled={pending[item.id]} onClick={() => { if (!busy.current.has(item.id)) transfers.dismiss(item.id); }}>Dismiss transfer</button> : <>
          {item.error && <p role="alert">{item.error}</p>}
        {!pending[item.id] && item.state !== 'Uploading' && <RetryUpload transfers={transfers} item={item} />}
          <button className="mt-[8px] !min-h-[44px] rounded-[8px] border border-newBorder bg-newBgColorInner px-[14px] py-[8px] font-[600] disabled:opacity-50" disabled={pending[item.id] || item.state === 'Finalizing'} onClick={() => void action(item.id, () => transfers.cancel(item.id), true)}>{pending[item.id] ? 'Cancelling…' : 'Cancel upload'}</button>
        </>}
      </div>
  );
  return <section aria-label="Video transfers" className="mt-[16px] min-w-0 max-h-[240px] shrink-0 overflow-y-auto text-newTextColor">
      {items.some(item => item.state === 'Uploading') && <div className="text-[12px] hidden mobile:block"><p>Keep this browser open and on screen while uploading.</p><p>You can browse other pages in this app while the upload continues.</p></div>}
      {items.filter(item => !completedIds.has(item.id)).map(renderTransfer)}
      {!!completed.length && <details>
        <summary className="cursor-pointer min-h-[44px] py-[12px] text-[13px]">
          Completed uploads ({completed.length})
        </summary>
        {completed.map(renderTransfer)}
      </details>}
  </section>;
}
