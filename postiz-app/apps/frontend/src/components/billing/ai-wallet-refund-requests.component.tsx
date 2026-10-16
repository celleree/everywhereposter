'use client';
import { useEffect, useRef, useState } from 'react';
import useSWR, { useSWRConfig } from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useUser } from '@gitroom/frontend/components/layout/user.context';
type Request = { id: string; operationKey: string; requestedNanos: string; createdAt: string; status: 'REQUESTED' };
type Summary = { organizationId: string; creditsExpire: false; purchasedNanos: string; eligibleNanos: string;
  usageHeldNanos: string; refundHeldNanos: string; requiresReconciliation: boolean; requests: Request[] };
const storageKey = (org: string) => `ai-wallet-refund:${org}`;
export function AiWalletRefundRequestsComponent({ formatAmount }: { formatAmount: (nanos: string) => string }) {
  const fetch = useFetch(), user = useUser(), org = user?.orgId;
  const { mutate: refreshResource } = useSWRConfig();
  const activeOrg = useRef(org); activeOrg.current = org;
  const [submitting, setSubmitting] = useState(false), [error, setError] = useState('');
  const admin = user?.role === 'ADMIN' || user?.role === 'SUPERADMIN';
  const { data, error: loadError, mutate } = useSWR<Summary>(user?.id && org ? ['/billing/ai-wallet/refund-requests', user.id, org] : null,
    async ([path]) => {
      const response = await fetch(path); if (!response.ok) throw Error('Refund request status unavailable');
      const value = await response.json();
      if (value.organizationId !== org || value.creditsExpire !== false || !Array.isArray(value.requests) ||
          ['purchasedNanos','eligibleNanos','usageHeldNanos','refundHeldNanos'].some(k => !/^[0-9]{1,19}$/.test(value[k]))) throw Error('Refund request status unavailable');
      return value;
    }, { shouldRetryOnError: false, keepPreviousData: false, refreshInterval: 15000 });
  useEffect(() => { setSubmitting(false); setError(''); }, [org]);
  useEffect(() => {
    if (!org || data?.organizationId !== org || !Array.isArray(data.requests)) return;
    try { if (data.requests.some(r => r.operationKey === localStorage.getItem(storageKey(org)))) localStorage.removeItem(storageKey(org)); } catch {}
  }, [org, data]);
  const submit = async () => {
    if (!org || !admin || submitting) return;
    const requestOrg = org; setSubmitting(true); setError('');
    try {
      let key = localStorage.getItem(storageKey(requestOrg));
      if (!key || !/^[a-zA-Z0-9_-]{16,100}$/.test(key)) { key = `refund_${crypto.randomUUID()}`; localStorage.setItem(storageKey(requestOrg), key); }
      const response = await fetch('/billing/ai-wallet/refund-requests', { method: 'POST', body: JSON.stringify({ operationKey: key }) });
      if (activeOrg.current !== requestOrg) return;
      if (!response.ok) throw Error('Request failed');
      const result = await response.json(); if (activeOrg.current !== requestOrg) return;
      if (result.status !== 'REQUESTED' || typeof result.id !== 'string' || result.operationKey !== key) throw Error('Request unconfirmed');
      localStorage.removeItem(storageKey(requestOrg)); await Promise.all([mutate(), refreshResource(['/billing/ai-wallet', user.id, requestOrg])]);
    } catch { if (activeOrg.current === requestOrg) setError('Could not confirm the request. Retry retains the same request identity.'); }
    finally { if (activeOrg.current === requestOrg) setSubmitting(false); }
  };
  if (org && loadError) return <p>Refund request status is unavailable. <button type="button" onClick={() => void mutate()}>Retry refund request status</button></p>;
  if (!org || !data || data.organizationId !== org || !Array.isArray(data.requests) ||
      (data.purchasedNanos === '0' && !data.requests.length)) return null;
  return <section aria-label="Unused credit refund requests" className="mb-6 min-w-0 break-words rounded-xl border border-white/15 p-4">
    <h2 className="text-lg font-semibold">Unused credit refund requests</h2>
    <p>Purchased credits never expire. You can request a refund of unused credits for manual review.</p>
    <p>Available for a request: {formatAmount(data.eligibleNanos)}. Pending usage: {formatAmount(data.usageHeldNanos)}. Pending refund requests: {formatAmount(data.refundHeldNanos)}.</p>
    <p>The requested balance stays on hold while the request is pending. Submitting a request does not approve or issue a refund.</p>
    {data.requiresReconciliation ? <p>Usage needs reconciliation before another request can be submitted.</p> : null}
    {admin ? <button type="button" disabled={submitting || data.requiresReconciliation || (data.eligibleNanos === '0' && !error)}
      onClick={() => void submit()} className="mt-3 min-h-11 rounded border px-3 py-2">{submitting ? 'Submitting request…' : 'Request refund review of available unused credits'}</button> : null}
    {error ? <p role="alert">{error}</p> : null}
    <h3 className="mt-3 font-semibold">Recent requests (up to 20)</h3>
    {!data.requests.length ? <p>No refund requests yet.</p> : <ul>{data.requests.map(r => <li key={r.id}>
      {formatAmount(r.requestedNanos)} — Awaiting manual review · <time dateTime={r.createdAt}>{new Date(r.createdAt).toLocaleString()}</time> · {r.id}
    </li>)}</ul>}
  </section>;
}
