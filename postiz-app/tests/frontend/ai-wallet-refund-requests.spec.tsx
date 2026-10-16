import React from 'react';
import { webcrypto } from 'crypto';
import { render, screen, waitFor, fireEvent, cleanup, act } from '@testing-library/react';
import { SWRConfig } from 'swr';
import { AiWalletRefundRequestsComponent } from '../../apps/frontend/src/components/billing/ai-wallet-refund-requests.component';
import { walletDollars } from '../../apps/frontend/src/components/billing/ai-wallet.component';
let mockUser={id:'user',orgId:'org-a',role:'ADMIN'};
const mockFetch=jest.fn();
jest.mock('@gitroom/helpers/utils/custom.fetch',()=>({useFetch:()=>mockFetch}));
jest.mock('@gitroom/frontend/components/layout/user.context',()=>({useUser:()=>mockUser}));
const prior=global.crypto;
beforeAll(()=>Object.defineProperty(global,'crypto',{configurable:true,value:webcrypto}));
afterAll(()=>Object.defineProperty(global,'crypto',{configurable:true,value:prior}));
const snapshot=(org='org-a')=>({organizationId:org,creditsExpire:false,purchasedNanos:'10000000000',eligibleNanos:'8000000000',usageHeldNanos:'2000000000',refundHeldNanos:'0',requiresReconciliation:false,requests:[] as any[]});
const response=(value:any)=>({ok:true,json:async()=>value});
const mount=()=>{const cache=new Map();const element=()=><SWRConfig value={{provider:()=>cache,dedupingInterval:0}}><AiWalletRefundRequestsComponent formatAmount={walletDollars}/></SWRConfig>;const view=render(element());return{view,rerender:()=>view.rerender(element())};};
beforeEach(()=>{mockUser={id:'user',orgId:'org-a',role:'ADMIN'};mockFetch.mockReset();localStorage.clear();});afterEach(cleanup);
it('shows no-expiry terms, excluded spend holds, and a request awaiting manual review',async()=>{
  let summary=snapshot();mockFetch.mockImplementation(async(_path,options)=>{
    if(!options?.method)return response(summary);
    const operationKey=JSON.parse(options.body).operationKey;const row={id:'request-one',operationKey,requestedNanos:'8000000000',createdAt:'2026-10-16T00:00:00Z',status:'REQUESTED'};
    summary={...summary,eligibleNanos:'0',refundHeldNanos:'8000000000',requests:[row]};return response(row);
  });mount();expect(await screen.findByText(/Purchased credits never expire/)).toBeTruthy();expect(screen.getByText(/Pending usage: \$2.00/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:/Request refund review/}));expect(await screen.findByText(/Awaiting manual review/)).toBeTruthy();
  const post=mockFetch.mock.calls.find(([,o])=>o?.method==='POST');expect(Object.keys(JSON.parse(post![1].body))).toEqual(['operationKey']);
  expect(screen.getByText(/does not approve or issue a refund/)).toBeTruthy();expect(localStorage.length).toBe(0);
});
it('retries an ambiguous request with the same organization-bound key',async()=>{
  let count=0;mockFetch.mockImplementation(async(_path,options)=>{if(!options?.method)return response(snapshot());if(++count===1)throw Error('interrupted');return response({id:'request',status:'REQUESTED',operationKey:JSON.parse(options.body).operationKey});});mount();await screen.findByText(/Purchased credits never expire/);
  fireEvent.click(screen.getByRole('button',{name:/Request refund review/}));await screen.findByRole('alert');fireEvent.click(screen.getByRole('button',{name:/Request refund review/}));
  await waitFor(()=>expect(mockFetch.mock.calls.filter(([,o])=>o?.method==='POST')).toHaveLength(2));
  const keys=mockFetch.mock.calls.filter(([,o])=>o?.method==='POST').map(([,o])=>JSON.parse(o.body).operationKey);expect(keys[1]).toBe(keys[0]);
});
it('keeps non-administrators read-only and blocks requests during reconciliation',async()=>{
  mockUser.role='USER';mockFetch.mockResolvedValue(response(snapshot()));const view=mount();await screen.findByText(/Purchased credits never expire/);expect(screen.queryByRole('button',{name:/Request refund review/})).toBeNull();view.view.unmount();
  mockUser.role='ADMIN';mockFetch.mockResolvedValue(response({...snapshot(),eligibleNanos:'0',requiresReconciliation:true}));mount();await screen.findByText(/Usage needs reconciliation/);expect((screen.getByRole('button',{name:/Request refund review/}) as HTMLButtonElement).disabled).toBe(true);
});
it('ignores a late request response after organization switching',async()=>{
  let resolve:any;mockFetch.mockImplementation(async(_path,options)=>options?.method?new Promise(r=>{resolve=r;}):response(snapshot(mockUser.orgId)));
  const view=mount();await screen.findByText(/Purchased credits never expire/);fireEvent.click(screen.getByRole('button',{name:/Request refund review/}));await waitFor(()=>expect(resolve).toBeTruthy());
  mockUser={...mockUser,orgId:'org-b'};view.rerender();await screen.findByText(/Purchased credits never expire/);
  await act(async()=>{resolve(response({status:'WRONG-ORG'}));await Promise.resolve();});expect(screen.queryByRole('alert')).toBeNull();
  expect(localStorage.getItem('ai-wallet-refund:org-a')).toBeTruthy();expect(localStorage.getItem('ai-wallet-refund:org-b')).toBeNull();
});
