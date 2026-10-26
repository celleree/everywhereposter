import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {readRendererIdentity,createExportAcceptance} from '../export-acceptance.mjs';

const hash=text=>createHash('sha256').update(text).digest('hex');
const accepted={ready:true,status:'ACCEPTED'},stale={ready:false,status:'STALE_NEEDS_VERIFICATION'};
async function fixture(t){
 const temp=await mkdtemp(path.join(os.tmpdir(),'ep-export-acceptance-'));
 t.after(()=>rm(temp,{recursive:true,force:true}));
 const root=path.join(temp,'13_editing_pipeline/v1'),dir=path.join(root,'projects/test');
 const files=[path.join(root,'run.mjs'),path.join(root,'src/render.tsx'),path.join(temp,'12_effect_library/v1/src/index.ts'),path.join(temp,'12_effect_library/v2/src/index.ts'),path.join(dir,'public/font.ttf')];
 for(const file of files){await mkdir(path.dirname(file),{recursive:true});await writeFile(file,'synthetic renderer input');}
 await mkdir(path.join(dir,'qa'));
 const project='{"revision":1}',output='synthetic export bytes; not a video';
 await writeFile(path.join(dir,'project.json'),project);await writeFile(path.join(dir,'final.mp4'),output);
 const current=()=>readRendererIdentity(root,files.at(-1));
 const {rendererHash}=await current(),projectHash=hash(project),sha256=hash(output);
 const r={status:'RENDERED_QA_PENDING',projectHash,rendererHash,sha256};
 const q={status:'PASS',projectSha256:projectHash,rendererHash,sha256};
 const save=async()=>{await writeFile(path.join(dir,'render-receipt.json'),JSON.stringify(r));await writeFile(path.join(dir,'qa/final-verification.json'),JSON.stringify(q));};
 await save();
 const start=identity=>createExportAcceptance({dir,root,projectHash,rendererHash:identity??rendererHash});
 return {dir,files,q,r,save,current,start,check:start()};
}

test('unchanged matching receipts keep an accepted download, including repeated checks',async t=>{
 const f=await fixture(t);
 assert.deepEqual(await f.check(),accepted);assert.deepEqual(await f.check(),accepted);
 assert.equal((await f.current()).rendererHash,f.r.rendererHash);
});

for(const receipt of ['q','r'])for(const identity of [undefined,'',null,'not-a-hash']){
 test(`${receipt} missing or invalid renderer identity (${String(identity)}) needs verification`,async t=>{
  const f=await fixture(t);f[receipt].rendererHash=identity;await f.save();
  assert.deepEqual(await f.check(),stale);
 });
}

for(const receipt of ['q','r','both']){
 test(`${receipt} has a stale or mismatched renderer identity`,async t=>{
  const f=await fixture(t);
  for(const key of receipt==='both'?['q','r']:[receipt])f[key].rendererHash='0'.repeat(64);
  await f.save();assert.deepEqual(await f.check(),stale);
 });
}

for(const [index,label] of ['runner','composition','v1 effects','v2 effects','font'].entries()){
 test(`changed ${label} invalidates an active preview and survives restart`,async t=>{
  const f=await fixture(t);assert.deepEqual(await f.check(),accepted);
  await writeFile(f.files[index],'changed renderer input');
  const identity=(await f.current()).rendererHash;assert.notEqual(identity,f.r.rendererHash);
  assert.deepEqual(await f.check(),stale);
  assert.deepEqual(await f.start(identity)(),stale);
 });
}

test('new matching receipts are accepted by a preview started with the new identity',async t=>{
 const f=await fixture(t);await writeFile(f.files[0],'changed runner');
 const {rendererHash}=await f.current();f.q.rendererHash=f.r.rendererHash=rendererHash;await f.save();
 assert.deepEqual(await f.check(),stale);assert.deepEqual(await f.start(rendererHash)(),accepted);
});

test('output tampering invalidates acceptance after an earlier successful check',async t=>{
 const f=await fixture(t);assert.deepEqual(await f.check(),accepted);
 await writeFile(path.join(f.dir,'final.mp4'),'tampered output');
 assert.deepEqual(await f.check(),stale);
});

test('matching receipts cannot hide an already changed output',async t=>{
 const f=await fixture(t);await writeFile(path.join(f.dir,'final.mp4'),'tampered output');
 assert.deepEqual(await f.check(),stale);
});

test('changed project and failed or mismatched receipts remain rejected',async t=>{
 const f=await fixture(t);
 for(const [object,key,value] of [[f.q,'status','FAIL'],[f.q,'projectSha256','0'.repeat(64)],[f.r,'projectHash','0'.repeat(64)],[f.q,'sha256','0'.repeat(64)]]){
  const previous=object[key];object[key]=value;await f.save();assert.deepEqual(await f.check(),stale);object[key]=previous;
 }
 await f.save();await writeFile(path.join(f.dir,'project.json'),'{"revision":2}');
 assert.deepEqual(await f.check(),stale);
});

test('missing and malformed receipts fail closed without changing the export',async t=>{
 const f=await fixture(t),output=await readFile(path.join(f.dir,'final.mp4'));
 await rm(path.join(f.dir,'qa/final-verification.json'));assert.deepEqual(await f.check(),stale);
 await f.save();await writeFile(path.join(f.dir,'render-receipt.json'),'{');assert.deepEqual(await f.check(),stale);
 assert.deepEqual(await readFile(path.join(f.dir,'final.mp4')),output);
});
