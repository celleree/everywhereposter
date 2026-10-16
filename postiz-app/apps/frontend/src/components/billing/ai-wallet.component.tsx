'use client';

import useSWR from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useUser } from '@gitroom/frontend/components/layout/user.context';

type Operation = { id: string; provider: string; model: string; state: string;
  ceilingNanos: string; chargedNanos: string | null; createdAt: string };
type Snapshot = { organizationId: string; currency: string; status: string;
  balanceNanos: string; heldNanos: string; availableNanos: string;
  entries: { id: string; kind: string; amountNanos: string; createdAt: string }[]; operations: Operation[] };

export function walletDollars(nanos: string) {
  if (typeof nanos !== 'string' || !/^\d{1,19}$/.test(nanos)) return 'Unavailable';
  const value = BigInt(nanos), scale = BigInt(1000000000);
  const fraction = (value % scale).toString().padStart(9, '0').replace(/0+$/, '').padEnd(2, '0');
  return `$${value / scale}.${fraction}`;
}
const status = (state: string) => ({ RESERVED: 'Reserved', DISPATCHED: 'Pending', UNKNOWN: 'Pending reconciliation',
  SETTLED: 'Settled', RELEASED: 'Released' }[state] || 'Pending reconciliation');

/** Read-only test-wallet view; no offer, pricing or purchase policy is selected. */
export function AiWalletComponent() {
  const fetch = useFetch();
  const user = useUser();
  const org = user?.orgId;
  const { data, error, isLoading, isValidating, mutate } = useSWR<Snapshot>(
    user?.id && org ? ['/billing/ai-wallet', user.id, org] : null,
    async ([path]) => {
      const response = await fetch(path);
      if (!response.ok) throw Error('Wallet unavailable');
      const value = await response.json();
      if (value.organizationId !== org || value.currency !== 'usd' ||
          !Array.isArray(value.entries) || !Array.isArray(value.operations)) throw Error('Wallet unavailable');
      return value;
    }, { shouldRetryOnError: false, keepPreviousData: false, refreshInterval: 15000 }
  );
  if (!org || isLoading) return <p role="status">Loading prepaid AI balance…</p>;
  if (error || !data || data.organizationId !== org) return <div role="alert">
    Prepaid AI balance is unavailable. <button type="button" onClick={() => void mutate()}>Retry balance</button>
  </div>;
  return <section aria-label="Prepaid AI balance" className="mb-6 min-w-0 rounded-xl border border-white/15 p-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="text-lg font-semibold">Prepaid AI balance <span className="text-sm font-normal">(test mode)</span></h2>
      <button type="button" disabled={isValidating} onClick={() => void mutate()} className="rounded border px-3 py-2 focus-visible:outline focus-visible:outline-2">
        {isValidating ? 'Refreshing…' : 'Refresh balance'}
      </button>
    </div>
    <dl className="my-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
      <div><dt>Available</dt><dd>{walletDollars(data.availableNanos)}</dd></div>
      <div><dt>Held for pending usage</dt><dd>{walletDollars(data.heldNanos)}</dd></div>
      <div><dt>Total balance</dt><dd>{walletDollars(data.balanceNanos)}</dd></div>
    </dl>
    <p className="text-sm">All amounts are USD. Pending holds are maximum reserved amounts, not final charges.</p>
    {data.status !== 'ACTIVE' ? <p role="status">Usage needs reconciliation. Pending amounts remain reserved.</p> : null}
    <h3 className="mt-4 font-semibold">Recent operations (up to 20)</h3>
    {!data.operations.length ? <p>No AI operations yet.</p> : <ul className="divide-y divide-white/10">
      {data.operations.map((operation) => <li key={operation.id} className="py-3 break-words">
        <p>{operation.provider} · {operation.model}</p>
        <time dateTime={operation.createdAt}>{new Date(operation.createdAt).toLocaleString()}</time>
        <p>{status(operation.state)} · {operation.state === 'SETTLED'
          ? `Charged ${walletDollars(operation.chargedNanos!)}`
          : operation.state === 'RELEASED' ? 'Hold released'
          : `Reserved maximum ${walletDollars(operation.ceilingNanos)}`}</p>
      </li>)}
    </ul>}
    <h3 className="mt-4 font-semibold">Recent settled transactions (up to 20)</h3>
    {!data.entries.length ? <p>No settled transactions yet.</p> : <ul className="divide-y divide-white/10">
      {data.entries.map((entry) => <li key={entry.id} className="py-2">
        {entry.kind === 'FUNDING' ? 'Top-up' : 'AI usage'} · {walletDollars(entry.amountNanos)}
        <time dateTime={entry.createdAt} className="ml-2 text-sm">{new Date(entry.createdAt).toLocaleString()}</time>
      </li>)}
    </ul>}
  </section>;
}
