import { webcrypto } from 'crypto';
import { TextEncoder, TextDecoder } from 'util';
import { requestMediaCopyGeneration } from '../../apps/frontend/src/components/new-launch/copy-generation.client';
const prior = global.crypto;
beforeAll(()=>{Object.defineProperty(global,'crypto',{configurable:true,value:webcrypto});Object.assign(global,{TextEncoder,TextDecoder});});
afterAll(()=>Object.defineProperty(global,'crypto',{configurable:true,value:prior}));
beforeEach(()=>localStorage.clear());
const body:any={mediaId:'media-retry',platforms:['linkedin'],goal:'position',sourceCaption:'Private source notes'};
const final=(status:string)=>({ok:true,status:200,body:{getReader:()=>{let done=false;return{read:async()=>done?{done:true}:(done=true,{done:false,value:new TextEncoder().encode(JSON.stringify({name:'completed',data:{status,results:[],imagePlans:[]}})+'\n')})};}}} as any);
it('retains one opaque key through transport/partial failure and clears only a completed request',async()=>{
  const fetch=jest.fn().mockRejectedValueOnce(Error('interrupted')).mockResolvedValueOnce(final('partial')).mockResolvedValueOnce(final('complete')).mockResolvedValueOnce(final('complete'));
  await expect(requestMediaCopyGeneration(fetch,body)).rejects.toThrow('interrupted');
  await requestMediaCopyGeneration(fetch,body);await requestMediaCopyGeneration(fetch,body);await requestMediaCopyGeneration(fetch,body);
  const requests=fetch.mock.calls.map(([,opts])=>JSON.parse(opts.body));
  expect(requests[0].requestKey).toMatch(/^[a-f0-9-]{36}$/);expect(requests[1].requestKey).toBe(requests[0].requestKey);expect(requests[2].requestKey).toBe(requests[0].requestKey);expect(requests[3].requestKey).not.toBe(requests[0].requestKey);
  expect(JSON.stringify(localStorage)).not.toContain('Private source notes');
});
it('keeps explicitly supplied keys and prevents dispatch if durable browser storage fails',async()=>{
  const fetch=jest.fn().mockResolvedValue(final('complete'));await requestMediaCopyGeneration(fetch,{...body,requestKey:'explicit-request-key-1'});
  expect(JSON.parse(fetch.mock.calls[0][1].body).requestKey).toBe('explicit-request-key-1');
  const fail=jest.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw Error('storage unavailable');});
  await expect(requestMediaCopyGeneration(fetch,body)).rejects.toThrow('storage unavailable');expect(fetch).toHaveBeenCalledTimes(1);fail.mockRestore();
});
