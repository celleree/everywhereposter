import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {fixture} from './fixture.mjs';
import {CAPTION_TIMING_CAPABILITY,captionFrameRange,captionFrameRanges,chunkContent,validateProject} from '../project.mjs';
import {readRendererIdentity,createExportAcceptance} from '../export-acceptance.mjs';

const policy='trim-trailing-hold-v1';
const digest=x=>createHash('sha256').update(x).digest('hex');
function project(words=[{id:'left',text:'Before',start:.1,end:1},{id:'right',text:'Go!',start:1,end:1.01}]){
  const p=fixture();p.words=words;p.captions=words.map(w=>({wordIds:[w.id]}));p.effects=[];p.broll=[];return p;
}
const visible=(ranges,frame)=>ranges.findIndex(([from,end])=>frame>=from&&frame<end);
test('opt-in removes only the Before tail and makes Go visible at frame 30',()=>{
  const p=project(),original=structuredClone(p);p.captionTimingPolicy=policy;
  assert.deepEqual(validateProject(p).captionRanges,[[3,30],[30,31]]);
  assert.equal(visible(captionFrameRanges(p),29),0);assert.equal(visible(captionFrameRanges(p),30),1);
  assert.equal(visible(captionFrameRanges(p),31),-1);
  assert.deepEqual(p.words,original.words);assert.deepEqual(p.captions,original.captions);
});
test('absent and explicit legacy policies preserve exact old ranges and first-active behavior',()=>{
  const p=project(),words=new Map(p.words.map(w=>[w.id,w]));
  const old=p.captions.map(c=>captionFrameRange(c,words,30,1.01));
  assert.deepEqual(old,[[3,31],[30,31]]);assert.deepEqual(captionFrameRanges(p),old);
  p.captionTimingPolicy='legacy-v1';assert.deepEqual(captionFrameRanges(p),old);assert.equal(visible(old,30),0);
});
test('unknown, malformed and null policies fail validation and projection',()=>{
  for(const value of [null,'trim-trailing-hold-v2','',false,{},['legacy-v1']]){
    const p=project();p.captionTimingPolicy=value;
    assert.throws(()=>validateProject(p),/caption timing policy/);
    assert.throws(()=>chunkContent(p,0,149),/caption timing policy/);
  }
});
test('capability command exposes the versioned discriminator without runtime or project',()=>{
  const actual=JSON.parse(execFileSync(process.execPath,[fileURLToPath(new URL('../run.mjs',import.meta.url)),'capabilities'],{encoding:'utf8'}));
  assert.deepEqual(actual,{captionTiming:{version:1,field:'captionTimingPolicy',default:'legacy-v1',policies:['legacy-v1',policy]}});
  assert.deepEqual(actual.captionTiming,CAPTION_TIMING_CAPABILITY);
});
test('policy is a cache dependency even when effective ranges match',()=>{
  const p=project(),key=()=>digest(JSON.stringify(chunkContent(p,2100,2249))),legacy=key();
  p.captionTimingPolicy='legacy-v1';assert.equal(key(),legacy);
  p.captionTimingPolicy=policy;assert.notEqual(key(),legacy);
});
test('next start across 5s changes predecessor dependency and keeps distant chunks reusable',()=>{
  const p=project([{id:'a',text:'Before',start:4.7,end:4.9},{id:'b',text:'Go!',start:5,end:5.2},
    {id:'c',text:'Distant',start:70,end:70.3}]);p.captionTimingPolicy=policy;
  const ranges=[[0,149],[150,299],[2100,2249]],snapshot=()=>ranges.map(r=>JSON.stringify(chunkContent(p,...r))),before=snapshot();
  assert.deepEqual(chunkContent(p,0,149).captions[0].frameRange,[141,150]);
  p.words[1].start=4.97;validateProject(p);const after=snapshot();
  assert.notEqual(after[0],before[0]);assert.notEqual(after[1],before[1]);assert.equal(after[2],before[2]);
  assert.deepEqual(chunkContent(p,0,149).captions[0].frameRange,[141,149]);
  p.words[1].start=5.05;assert.deepEqual(chunkContent(p,150,299).captions[0].frameRange,[141,151]);
});
test('real overlap, same-frame, zero-duration, final group and long pause retain legacy behavior',()=>{
  for(const times of [[[.1,1],[.99,1.01]],[[.1,.11],[.12,.13]],[[.1,.1],[.1,.2]],[[.1,.1],[.11,.2]],[[.1,1],[10,10.3]],[[.1,.1],[1,1]]]){
    const p=project(times.map(([start,end],i)=>({id:String(i),text:'Word',start,end}))),old=captionFrameRanges(p);
    p.captionTimingPolicy=policy;assert.deepEqual(validateProject(p).captionRanges,old);
  }
  const p=project([{id:'a',text:'Zero',start:.1,end:.1},{id:'b',text:'Next',start:.2,end:.3}]);p.captionTimingPolicy=policy;
  assert.deepEqual(captionFrameRanges(p),[[3,6],[6,9]]);
});
test('a nested word end protects actual speech even if the last word ends earlier',()=>{
  const p=project([{id:'a',text:'Long',start:.1,end:1},{id:'b',text:'Short',start:.5,end:.7},{id:'c',text:'Next',start:.8,end:1.2}]);
  p.captions=[{wordIds:['a','b']},{wordIds:['c']}];const old=captionFrameRanges(p);p.captionTimingPolicy=policy;
  assert.deepEqual(captionFrameRanges(p),old);
});
test('stale renderer receipts and final/cache bytes remain intact and cannot retain acceptance',async t=>{
  const temp=await mkdtemp(path.join(os.tmpdir(),'ep-caption-policy-'));t.after(()=>rm(temp,{recursive:true,force:true}));
  const root=path.join(temp,'13_editing_pipeline/v1'),dir=path.join(temp,'project');
  for(const v of ['v1','v2'])await mkdir(path.join(temp,'12_effect_library',v,'src'),{recursive:true});
  await mkdir(path.join(root,'src'),{recursive:true});await mkdir(path.join(dir,'public'),{recursive:true});await mkdir(path.join(dir,'qa'));
  await writeFile(path.join(root,'project.mjs'),'old timing source');await writeFile(path.join(dir,'public/font.ttf'),'synthetic font');
  const projectBytes=JSON.stringify(project()),final='synthetic old final',cache='synthetic old cached chunk';
  await writeFile(path.join(dir,'project.json'),projectBytes);await writeFile(path.join(dir,'final.mp4'),final);await writeFile(path.join(root,'old-cache.mp4'),cache);
  const {rendererHash}=await readRendererIdentity(root,path.join(dir,'public/font.ttf')),projectHash=digest(projectBytes),sha256=digest(final);
  const receipts={'render-receipt.json':JSON.stringify({projectHash,rendererHash,sha256}),
    'qa/final-verification.json':JSON.stringify({status:'PASS',projectSha256:projectHash,rendererHash,sha256})};
  for(const [name,bytes] of Object.entries(receipts))await writeFile(path.join(dir,name),bytes);
  // Non-Easy profile skips unrelated tool bindings; still exercises real source identity/receipt checks.
  const check=()=>createExportAcceptance({dir,root,projectHash,rendererHash})();
  assert.equal((await check()).ready,true);
  await writeFile(path.join(root,'project.mjs'),'new timing source');assert.equal((await check()).ready,false);
  for(const [name,bytes] of Object.entries(receipts))assert.equal(await readFile(path.join(dir,name),'utf8'),bytes);
  assert.equal(await readFile(path.join(dir,'project.json'),'utf8'),projectBytes);
  assert.equal(await readFile(path.join(dir,'final.mp4'),'utf8'),final);assert.equal(await readFile(path.join(root,'old-cache.mp4'),'utf8'),cache);
});
