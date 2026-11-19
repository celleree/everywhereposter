import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdtempSync, mkdirSync, openSync, closeSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { authorize, observations, prepare, verify } from './codex-execution.mjs';

const policy = JSON.parse(readFileSync(new URL('./codex-execution-policy.json',import.meta.url)));
const requested = {model:'gpt-6.1-sol',reasoningEffort:'high',source:'github-actions-vars'};
const bindings = {helperSha256:'a'.repeat(64),policySha256:'b'.repeat(64)};
const identity = {revision:'c'.repeat(40),runId:'123',runAttempt:'1',recoveryRecord:'private-fixture'};
const argv = (prompt='normal') => ['--ask-for-approval','never','exec','--ephemeral','--ignore-user-config','--model',requested.model,'--config','model_reasoning_effort="high"','--json','--sandbox','workspace-write',prompt];
const root=mkdtempSync(join(tmpdir(),'ep-execution-test-'));
after(()=>rmSync(root,{recursive:true,force:true}));
const digest=value=>createHash('sha256').update(value).digest('hex');
const usage={input_tokens:12,cached_input_tokens:3,output_tokens:4};
const stream=event=>Buffer.from(JSON.stringify(event)+'\n');
const completion=(value=usage)=>({type:'turn.completed',usage:value});
let sequence=0;
function fixture() {
 const path=join(root,String(sequence++));mkdirSync(path,{mode:0o700});mkdirSync(join(path,'bin'));
 const file=join(path,'execution.json'),stdout=join(path,'stdout'),stderr=join(path,'stderr');
 writeFileSync(stdout,'',{mode:0o600});writeFileSync(stderr,'',{mode:0o600});
 const helper=join(path,'helper.mjs'),policyFile=join(path,'policy.json');
 copyFileSync(new URL('./codex-execution.mjs',import.meta.url),helper);writeFileSync(policyFile,JSON.stringify(policy));
 const bound={helperSha256:digest(readFileSync(helper)),policySha256:digest(readFileSync(policyFile))};
 return {path,file,stdout,stderr,helper,policyFile,bound};
}

test('explicit pair/source only, full allowlist retained, Astra and unsupported pairs rejected without fallback',()=>{
 assert.deepEqual(authorize(policy,requested),requested);
 for(const input of [{...requested,model:''},{...requested,reasoningEffort:''},{...requested,source:''},{...requested,source:'user-config'},{...requested,model:'gpt-6.1-terra'},{...requested,model:'gpt-6-astra'},{...requested,model:'gpt-6-luna',reasoningEffort:'ultra'},{...requested,reasoningEffort:'extra-high'},{...requested,reasoningEffort:'HIGH'}])assert.throws(()=>authorize(policy,input));
 assert.deepEqual(authorize(policy,{...requested,model:'gpt-6-luna',reasoningEffort:'max'}),{...requested,model:'gpt-6-luna',reasoningEffort:'max'});
 assert.deepEqual(policy.globalAllowlist,['gpt-6-luna','gpt-6.1-sol','gpt-6-astra']);
 assert.equal(policy.advertisedSnapshot.clientVersion,'0.164.0');assert.equal(policy.cliObservation.version,'codex-cli 0.163.0');assert.equal(policy.remoteSupport,'unverified');
});
test('intent binds exact settings/policy/helper/run/revision/argv; no invocation or observed inference before spawn',()=>{
 const f=fixture(),result=prepare(policy,bindings,requested,identity,argv(),f.file),receipt=verify(f.file,result.sha256);
 assert.equal(receipt.invoked,null);assert.equal(receipt.observed.model,null);assert.equal(receipt.observed.reasoningEffort,null);assert.equal(receipt.billedCost,null);
 assert.deepEqual(receipt.requested,receipt.authorized);assert.deepEqual(receipt.identity,identity);assert.equal(receipt.policy.helperSha256,bindings.helperSha256);assert.equal(receipt.digests.argv,digest(Buffer.from(JSON.stringify(argv())+'\n')));
 for(const args of [argv().filter(v=>v!=='--json'),[...argv(),'--model','gpt-6-luna'],[...argv(),'--config','model="gpt-6-luna"'],argv().map(v=>v==='model_reasoning_effort="high"'?'model_reasoning_effort=high':v)])assert.throws(()=>prepare(policy,bindings,requested,identity,args,join(f.path,'denied-'+Math.random())));
 writeFileSync(f.file,'{}');assert.throws(()=>verify(f.file,result.sha256));
});
test('only top-level completion metrics are CLI-reported; model/effort/cost stay unknown with line/event provenance',()=>{
 const bytes=Buffer.concat([stream({type:'thread.started'}),stream({type:'item.completed',item:{text:'{"type":"turn.completed","usage":{"input_tokens":999}}'}}),stream({...completion(),model:'spoofed-model',reasoning_effort:'ultra'})]);
 const result=observations(bytes);
 assert.equal(result.model,null);assert.equal(result.reasoningEffort,null);assert.equal(result.telemetry.status,'cli_reported');assert.equal(result.telemetry.line,3);assert.equal(result.telemetry.event,'turn.completed');assert.equal(result.telemetry.stdoutSha256,digest(bytes));
 assert.deepEqual(result.usage,{...usage,reasoning_output_tokens:null});
 const partial=observations(stream(completion({input_tokens:5})));assert.equal(partial.usage.output_tokens,null);
});
test('malformed, truncated, duplicate, nested/spoofed, oversized, ambiguous and unsafe telemetry remains unknown',()=>{
 const unknown=[Buffer.alloc(0),Buffer.from(JSON.stringify(completion())),Buffer.from('not JSON\n'),stream({type:'item.completed',item:{usage}}),stream({type:'turn.completed',message:{usage}}),Buffer.concat([stream(completion()),stream(completion())]),Buffer.from('{"type":"item.completed","type":"turn.completed","usage":{"input_tokens":1}}\n'),stream(completion({input_tokens:-1})),stream(completion({input_tokens:1.5})),stream(completion({input_tokens:Number.MAX_SAFE_INTEGER+1})),stream(completion({input_tokens:'12'})),stream(completion({input_tokens:1,cached_input_tokens:2})),stream(completion({output_tokens:1,reasoning_output_tokens:2})),stream(completion({input_tokens:1,price:1})),Buffer.concat([stream(completion()),stream({type:'error'})]),Buffer.alloc(4*1024*1024+1),Buffer.from([0xff,10]),Buffer.from('\n'.repeat(8194)),stream({type:'item.completed',item:{text:'x'.repeat(65536)}})];
 for(const bytes of unknown){const result=observations(bytes);assert.equal(result.usage,null);assert.equal(result.telemetry.status,'unknown');assert.equal(result.model,null);}
});

// Exercise the actual read-once wrapper bootstrap with a disposable executable, never Codex/provider.
const task=readFileSync(new URL('./codex-task.sh',import.meta.url),'utf8');
const bootstrap=task.slice(task.indexOf("EXECUTION_BOOTSTRAP=$(cat <<'NODE'\n")+"EXECUTION_BOOTSTRAP=$(cat <<'NODE'\n".length,task.indexOf('\nNODE\n)\nexecution_call()'));
function executable(f) {
 const code=`#!/usr/bin/env node\nconst fs=require('node:fs');\nconst args=process.argv.slice(2);fs.writeFileSync(process.env.FIXTURE_ARGV,JSON.stringify(args));\nconst mode=args.at(-1);\nif(mode==='signal'){process.on('SIGTERM',()=>{fs.writeFileSync(process.env.FIXTURE_SIGNAL,'SIGTERM');process.exit(143)});fs.writeFileSync(process.env.FIXTURE_READY,'ready');setTimeout(()=>process.exit(99),5000)}\nelse { console.log(JSON.stringify({type:'turn.completed',usage:${JSON.stringify(usage)}}));console.error(JSON.stringify({type:'turn.completed',usage:{input_tokens:999}}));if(mode==='receipt-failure')fs.chmodSync(process.env.FIXTURE_RECEIPT,0o644);if(mode==='ancestor-swap'){fs.renameSync(process.env.FIXTURE_SWAP,process.env.FIXTURE_SWAP+'.original');fs.symlinkSync(process.env.FIXTURE_TARGET,process.env.FIXTURE_SWAP)}process.exit(mode==='nonzero'?7:0); }\n`;
 writeFileSync(join(f.path,'bin','codex'),code,{mode:0o700});
}
function start(f,prompt='normal',{missing=false,tamper=null}={}) {
 const args=argv(prompt),intent=prepare(policy,f.bound,requested,identity,args,f.file);executable(f);
 if(tamper==='helper')writeFileSync(f.helper,'throw new Error("PRIVATE-HELPER-SENTINEL")');
 if(tamper==='policy')writeFileSync(f.policyFile,'{}');
 if(tamper==='intent')writeFileSync(f.file,'{}');
 const out=openSync(f.stdout,'w'),err=openSync(f.stderr,'w');
 const child=spawn(process.execPath,['--input-type=module','--eval',bootstrap,f.helper,f.bound.helperSha256,f.policyFile,f.bound.policySha256,'launch',f.file,intent.sha256,f.stdout,...args],{env:{...process.env,PATH:missing?join(f.path,'missing'):join(f.path,'bin')+':'+process.env.PATH,FIXTURE_ARGV:join(f.path,'argv.json'),FIXTURE_READY:join(f.path,'ready'),FIXTURE_SIGNAL:join(f.path,'signal'),FIXTURE_RECEIPT:f.file,FIXTURE_SWAP:f.swap,FIXTURE_TARGET:f.target},stdio:['ignore',out,err,'pipe']});
 closeSync(out);closeSync(err);let control='';child.stdio[3].on('data',bytes=>control+=bytes.toString());
 return {child,done:new Promise(resolve=>child.once('close',(code,signal)=>resolve({code,signal,control}))),args};
}
test('actual launcher passes exact argv once, records OS start and nonzero exit without fallback or stderr scraping',async()=>{
 for(const prompt of ['normal','nonzero']) {
  const f=fixture(),run=start(f,prompt),result=await run.done;
  assert.equal(result.code,prompt==='normal'?0:7);assert.equal(result.signal,null);
  const control=JSON.parse(result.control),receipt=verify(f.file,control.sha256);
  assert.deepEqual(JSON.parse(readFileSync(join(f.path,'argv.json'))),run.args);
  assert.equal(receipt.invoked.trust,'os_process_started');assert.equal(receipt.invoked.model,requested.model);assert.equal(receipt.observed.model,null);assert.equal(receipt.observed.usage.input_tokens,12);assert.equal(receipt.result.exitCode,result.code);assert.equal(receipt.result.signal,null);assert.ok(receipt.result.elapsedMs>=0);assert.equal(receipt.billedCost,null);
 }
});
test('spawn failure leaves invoked null; digest/helper/policy tamper and receipt persistence fail closed',async()=>{
 const missing=fixture(),failure=await start(missing,'normal',{missing:true}).done;
 assert.equal(failure.code,1);const receipt=verify(missing.file,JSON.parse(failure.control).sha256);assert.equal(receipt.invoked,null);assert.equal(receipt.result.spawnError,'ENOENT');assert.equal(receipt.result.exitCode,null);
 for(const tamper of ['helper','policy','intent']){const f=fixture(),result=await start(f,'normal',{tamper}).done;assert.equal(result.code,1);assert.equal(result.control,'');assert.equal(existsSync(join(f.path,'argv.json')),false);assert.doesNotMatch(readFileSync(f.stderr,'utf8'),/PRIVATE-HELPER-SENTINEL/);}
 const failed=fixture(),result=await start(failed,'receipt-failure').done;assert.equal(result.code,1);assert.equal(result.control,'');
});
test('receipt ancestors must be real directories and the receipt parent must be private before any child starts',()=>{
 const f=fixture(),real=join(f.path,'real');mkdirSync(real,{mode:0o700});
 symlinkSync(real,join(f.path,'linked'));
 mkdirSync(join(real,'nested'),{mode:0o700});
 for(const file of [join(f.path,'linked','execution.json'),join(f.path,'linked','nested','execution.json')])assert.throws(()=>prepare(policy,bindings,requested,identity,argv(),file));
 chmodSync(real,0o755);assert.throws(()=>prepare(policy,bindings,requested,identity,argv(),join(real,'execution.json')));
 assert.equal(existsSync(join(real,'execution.json')),false);
});
test('child ancestor swap cannot redirect receipt persistence or yield accepted completion',async()=>{
 for(const nested of [false,true]) {
  const f=fixture();f.swap=join(f.path,'exposed');f.target=join(f.path,'protected');
  mkdirSync(f.swap,{mode:0o700});mkdirSync(f.target,{mode:0o700});
  if(nested){mkdirSync(join(f.swap,'receipts'),{mode:0o700});mkdirSync(join(f.target,'receipts'),{mode:0o700});}
  const suffix=nested?'receipts/execution.json':'execution.json';f.file=join(f.swap,suffix);
  const target=join(f.target,suffix),marker=Buffer.from('FIXTURE-OWNED-0600-MARKER\n');writeFileSync(target,marker,{mode:0o600});
  const result=await start(f,'ancestor-swap').done;
  assert.equal(result.code,1);assert.equal(result.control,'');assert.deepEqual(readFileSync(target),marker);
  const original=JSON.parse(readFileSync(join(f.swap+'.original',suffix)));
  assert.equal(original.result,null);assert.equal(original.invoked.trust,'os_process_started');
  assert.match(readFileSync(f.stderr,'utf8'),/private receipt could not be verified/);
 }
});
test('launcher forwards SIGTERM to its direct executable child and records interruption without stranding it',{timeout:10000},async()=>{
 const f=fixture(),run=start(f,'signal');
 const deadline=Date.now()+5000;
 while(!existsSync(join(f.path,'ready'))&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,10));
 assert.equal(existsSync(join(f.path,'ready')),true);run.child.kill('SIGTERM');
 const result=await run.done;assert.equal(result.code,143);assert.equal(readFileSync(join(f.path,'signal'),'utf8'),'SIGTERM');
 const receipt=verify(f.file,JSON.parse(result.control).sha256);assert.equal(receipt.result.receivedSignal,'SIGTERM');assert.equal(receipt.result.exitCode,143);assert.equal(receipt.invoked.trust,'os_process_started');
});
