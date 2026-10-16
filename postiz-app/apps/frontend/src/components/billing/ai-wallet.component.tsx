'use client';

import { useEffect, useRef, useState } from 'react';
import useSWR from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useUser } from '@gitroom/frontend/components/layout/user.context';

type Operation = { id: string; provider: string; model: string; state: string;
  ceilingNanos: string; chargedNanos: string | null; createdAt: string };
type Snapshot = { organizationId: string; currency: string; status: string;
  balanceNanos: string; heldNanos: string; availableNanos: string;
  entries: { id: string; kind: string; amountNanos: string; createdAt: string }[]; operations: Operation[] };
type Offer = { id: string; amountCents: number };
type Checkout = { topupId: string; status: string; url: string | null };

export function walletDollars(nanos: string) {
  if (typeof nanos !== 'string' || !/^\d{1,19}$/.test(nanos)) return 'Unavailable';
  const value = BigInt(nanos), scale = BigInt(1000000000);
  const fraction = (value % scale).toString().padStart(9, '0').replace(/0+$/, '').padEnd(2, '0');
  return `$${value / scale}.${fraction}`;
}
const status = (state: string) => ({ RESERVED: 'Reserved', DISPATCHED: 'Pending', UNKNOWN: 'Pending reconciliation',
  SETTLED: 'Settled', RELEASED: 'Released' }[state] || 'Pending reconciliation');
const offerDollars = (cents: number) => `$${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
const storedOperation = (org: string, offer: string) => `ai-wallet-topup:${org}:${offer}`;
const storedActiveOffer = (org: string) => `ai-wallet-topup-active:${org}`;
const readOffers = (value: unknown): Offer[] => {
  if (!Array.isArray(value) || value.some((offer) => !offer || typeof offer.id !== 'string' ||
      !/^[a-zA-Z0-9_-]{1,100}$/.test(offer.id) || !Number.isSafeInteger(offer.amountCents) ||
      offer.amountCents < 1) || new Set(value.map((offer) => offer.id)).size !== value.length) {
    throw Error('Test top-ups unavailable');
  }
  return value;
};
const safeCheckoutUrl = (value: unknown) => {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return url.origin === 'https://checkout.stripe.com' && !url.username && !url.password ? url.href : null;
  } catch { return null; }
};
const operationKey = (org: string, offer: string) => {
  const storageKey = storedOperation(org, offer), existing = sessionStorage.getItem(storageKey);
  if (existing && /^[a-zA-Z0-9_-]{1,100}$/.test(existing)) return existing;
  const random = new Uint32Array(4); crypto.getRandomValues(random);
  const key = 'wallet_' + Array.from(random, (value) => value.toString(36)).join('_');
  sessionStorage.setItem(storageKey, key);
  return key;
};

/** Test-wallet view. Offers and purchase availability always come from the server. */
export function AiWalletComponent({ navigate = (url) => window.location.assign(url) }:
    { navigate?: (url: string) => void } = {}) {
  const fetch = useFetch();
  const user = useUser();
  const org = user?.orgId;
  const admin = user?.role === 'ADMIN' || user?.role === 'SUPERADMIN';
  const hasWalletPlan = !!user?.tier && 'prepaid_ai' in user.tier && user.tier.prepaid_ai === true;
  const canPurchase = hasWalletPlan && admin;
  const activeOrg = useRef(org);
  activeOrg.current = org;
  const [purchasing, setPurchasing] = useState<string>();
  const [purchaseError, setPurchaseError] = useState('');
  const [purchaseStatus, setPurchaseStatus] = useState('');
  const { data, error, isLoading, isValidating, mutate } = useSWR<Snapshot>(
    hasWalletPlan && user?.id && org ? ['/billing/ai-wallet', user.id, org] : null,
    async ([path]) => {
      const response = await fetch(path);
      if (!response.ok) throw Error('Wallet unavailable');
      const value = await response.json();
      if (value.organizationId !== org || value.currency !== 'usd' ||
          !Array.isArray(value.entries) || !Array.isArray(value.operations)) throw Error('Wallet unavailable');
      return value;
    }, { shouldRetryOnError: false, keepPreviousData: false, refreshInterval: 15000 }
  );
  const { data: offers, error: offersError, isLoading: offersLoading, mutate: retryOffers } = useSWR<Offer[]>(
    canPurchase && user?.id && org ? ['/billing/ai-wallet/offers', user.id, org] : null,
    async ([path]) => {
      const response = await fetch(path);
      if (!response.ok) throw Error('Test top-ups unavailable');
      return readOffers(await response.json());
    }, { shouldRetryOnError: false, keepPreviousData: false }
  );

  useEffect(() => {
    setPurchasing(undefined); setPurchaseError(''); setPurchaseStatus('');
  }, [org]);

  useEffect(() => {
    if (!org || !hasWalletPlan) return;
    const result = new URLSearchParams(window.location.search).get('wallet');
    if (result === 'return') {
      setPurchaseStatus('Payment return received. Refreshing the server balance…');
      void mutate();
    } else if (result === 'cancel') {
      setPurchaseStatus('Test checkout canceled. You can reopen the same purchase safely.');
    }
  }, [org, hasWalletPlan, mutate]);

  const purchase = async (offer: Offer) => {
    if (!org || !canPurchase || purchasing) return;
    const purchaseOrg = org;
    setPurchasing(offer.id); setPurchaseError(''); setPurchaseStatus('');
    try {
      const key = operationKey(purchaseOrg, offer.id);
      sessionStorage.setItem(storedActiveOffer(purchaseOrg), offer.id);
      const response = await fetch('/billing/ai-wallet/topups', { method: 'POST',
        body: JSON.stringify({ offerId: offer.id, operationKey: key }) });
      if (activeOrg.current !== purchaseOrg) return;
      if (!response.ok) throw Error('Checkout unavailable');
      const value = await response.json() as Checkout;
      if (activeOrg.current !== purchaseOrg) return;
      if (!value || typeof value.topupId !== 'string' || typeof value.status !== 'string' ||
          !(value.url === null || typeof value.url === 'string')) throw Error('Checkout unavailable');
      if (value.status === 'funded' && value.url === null) {
        sessionStorage.removeItem(storedOperation(purchaseOrg, offer.id));
        sessionStorage.removeItem(storedActiveOffer(purchaseOrg));
        setPurchaseStatus('Payment is already recorded. Refreshing the server balance…');
        await mutate();
      } else {
        const url = safeCheckoutUrl(value.url);
        if (!url) throw Error('Checkout unavailable');
        navigate(url);
      }
    } catch {
      if (activeOrg.current === purchaseOrg) {
        setPurchaseError('Could not open secure test checkout. Retry uses the same purchase request.');
      }
    } finally {
      if (activeOrg.current === purchaseOrg) setPurchasing(undefined);
    }
  };

  if (!org || !hasWalletPlan) return null;
  if (isLoading) return <p role="status">Loading prepaid AI balance…</p>;
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
    {canPurchase ? <div className="mt-4 rounded-lg border border-white/15 p-3">
      <h3 className="font-semibold">Add test balance</h3>
      <p className="text-sm">Stripe test mode only. Balance changes only after the server verifies payment.</p>
      {offersLoading ? <p role="status">Loading test top-ups…</p>
        : offersError ? <p role="alert">Test top-ups are unavailable. <button type="button" onClick={() => void retryOffers()}>Retry test top-ups</button></p>
        : offers?.length ? <div className="mt-3 flex flex-wrap gap-2">{offers.map((offer) =>
          <button key={offer.id} type="button" disabled={!!purchasing || data.status !== 'ACTIVE'}
            onClick={() => void purchase(offer)} className="min-h-11 rounded border px-3 py-2 focus-visible:outline focus-visible:outline-2">
            {purchasing === offer.id ? 'Opening test checkout…' : `Add ${offerDollars(offer.amountCents)} test balance`}
          </button>)}</div>
        : <p>Test top-ups are unavailable.</p>}
      {purchaseError ? <p role="alert" className="mt-2">{purchaseError}</p> : null}
      {purchaseStatus ? <p role="status" className="mt-2">{purchaseStatus}</p> : null}
    </div> : null}
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
