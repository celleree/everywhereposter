'use client';
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useUser } from '../layout/user.context';
import { useVariables } from '@gitroom/react/helpers/variable.context';
import { ResumableTransfers, Transfer } from './resumable-transfer';

const TransfersContext = createContext<ResumableTransfers | null>(null);
export const useResumableTransfers = () => useContext(TransfersContext);

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
  return <TransfersContext.Provider value={transfers}>
    {children}
    {items.length > 0 && <aside aria-label="Video transfers" className="fixed bottom-[90px] right-[12px] z-[95] max-h-[40vh] w-[340px] max-w-[calc(100vw-24px)] overflow-auto rounded border border-newBorder bg-newBgColorInner p-[12px] shadow-menu">
      {actionError && <p role="alert">{actionError}</p>}
      <p className="text-[12px]">You can navigate within this app. Closing the browser pauses unfinished transfers; return and select the original video to resume.</p>
      {items.map(item => <div key={item.id} className="mt-[8px] border-t border-newBorder pt-[8px]">
        <p className="break-all">{item.name}</p><p role="status">{item.state} — {Math.floor(item.sent / Math.max(1, item.bytes) * 100)}%</p>
        {item.state === 'Transfer complete' ? <p>Safe to leave. Your video is saved in Media Library.</p> : <>
          {item.error && <p role="alert">{item.error}</p>}
          {item.state === 'Uploading' ? <button className="min-h-[44px] px-[8px]" onClick={() => transfers.pause(item.id)}>Pause</button> : <label className="block min-h-[44px]">Resume with original video<input aria-label={`Resume ${item.name}`} type="file" accept=".mp4,.mov,video/mp4,video/quicktime" onChange={event => { const file = event.target.files?.[0]; if (file) void transfers.resume(item.id, file).catch(() => {}); event.target.value = ''; }} /></label>}
          <button className="min-h-[44px] px-[8px]" onClick={() => void transfers.cancel(item.id).catch(error => setActionError(error.message))}>Cancel upload</button>
        </>}
      </div>)}
    </aside>}
  </TransfersContext.Provider>;
}
