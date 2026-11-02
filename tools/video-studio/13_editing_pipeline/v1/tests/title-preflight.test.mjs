import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './fixture.mjs';
import {validateProject} from '../project.mjs';
import {layoutInputHash,preflightFrames,withPreflightBrowser} from '../title-preflight.mjs';
const make=()=>{
 const p=fixture();p.schemaVersion=2;p.profile='talking-head-v2';p.canvas={width:1080,height:1920,fps:30};p.source.frames=900;p.assets=p.assets.slice(0,1);p.cuts=[{in:0,out:900,reason:'whole'}];p.broll=[];p.effects=[];
 p.words.forEach((w,i)=>{w.start=1+i;w.end=1.4+i;w.text=['Yes','Go','Now','Next'][i];});p.speaker.faces=[{t:0,x:300,y:700,width:400,height:400}];
 p.safeZones={version:1,profiles:['linkedin-organic-v1']};
 p.title={version:1,text:p.words.slice(0,3).map(w=>w.text).join(' '),wordIds:p.words.slice(0,3).map(w=>w.id),from:0,frames:90,bounds:{x:120,y:270,width:740,height:220},style:'block-title-v1'};return p;
};
test('preflight projection freezes layout but permits note and identity edits',()=>{
 const p=make(),hash=layoutInputHash(p);
 assert.equal(hash,'8bdcada708801f53844d862971293239e7564cc5c88b4b82c794082132ab2db7');
 const clock=structuredClone(p);clock.words[0].start+=.1;assert.equal(layoutInputHash(clock),'375c0f0a3cd2624ebc843f674b678f6971963c4918e12db46b8518a35ef12a3e');
 const q=structuredClone(p);q.id='different';q.revision=2;q.director.summary='Changed';q.cuts[0].reason='Changed';assert.equal(layoutInputHash(q),hash);
 for(const change of [x=>x.words[0].text+='x',x=>x.words[0].start+=.1,x=>x.title.bounds.x++,x=>x.speaker.faces[0].x++,x=>x.safeZones.profiles=[]]){
  const x=structuredClone(p);change(x);assert.notEqual(layoutInputHash(x),hash);
 }
});
test('selection covers each first-active group and title states; hidden or empty groups fail',()=>{
 const p=make(),frames=preflightFrames(p);assert.ok(frames.includes(0));assert.ok(frames.includes(30));assert.ok(frames.includes(90));
 const hidden=structuredClone(p);hidden.words[1].start=hidden.words[0].start;hidden.words[1].end=hidden.words[0].end;assert.throws(()=>preflightFrames(hidden),/visible/);
 const empty=structuredClone(p);empty.words.at(-1).end=empty.words.at(-1).start;assert.throws(()=>preflightFrames(empty),/visible/);
 const absent=structuredClone(p);delete absent.title;validateProject(absent);assert.throws(()=>preflightFrames(absent),/title project/);
});
test('more than 128 distinct visible states fails before rendering',()=>{
 const p=make();p.words=Array.from({length:129},(_,i)=>({id:'w'+i,text:'Word',start:i*.2,end:i*.2+.1}));p.captions=p.words.map(w=>({wordIds:[w.id]}));
 p.title.wordIds=['w0','w1','w2'];p.title.text='Word Word Word';
 assert.throws(()=>preflightFrames(p),/128/);
});

test('primary rejection survives page/browser cleanup failures without unhandled rejections',async()=>{
 const unhandled=[],listener=error=>unhandled.push(error);process.on('unhandledRejection',listener);
 try{
  for(const mode of ['sync','async','pending']){
   const primary=Error('Title cannot fit at 96px'),cleanup=Error('Target.closeTarget'),events=[];
   let rejectClose,calls=0;
   const page={close(){calls++;events.push('page-close');if(mode==='sync')throw cleanup;if(mode==='async')return Promise.reject(cleanup);return new Promise((_,reject)=>{rejectClose=reject;});}};
   const close=page.close,browser={async newPage(){return page;},close(){events.push('browser-close');throw Error('browser cleanup');}},create=browser.newPage;
   await assert.rejects(withPreflightBrowser(browser,async b=>{
    const p=await b.newPage();assert.equal(p.close(),p.close());throw primary;
   },10),error=>error===primary);
   if(rejectClose)rejectClose(cleanup); // Late native rejection is still consumed.
   await new Promise(setImmediate);
   assert.equal(calls,1);assert.deepEqual(events,['page-close','browser-close']);
   assert.equal(page.close,close);assert.equal(browser.newPage,create);
  }
  assert.deepEqual(unhandled,[]);
 }finally{process.off('unhandledRejection',listener);}
});
test('cleanup-only synchronous/asynchronous failures reject instead of allowing success',async()=>{
 for(const target of ['page','browser'])for(const mode of ['sync','async']){
  const cleanup=Error(target+' cleanup'),events=[];
  const fail=()=>{if(mode==='sync')throw cleanup;return Promise.reject(cleanup);};
  const page={close(){events.push('page-close');return target==='page'?fail():Promise.resolve();}};
  const browser={async newPage(){return page;},close(){events.push('browser-close');return target==='browser'?fail():Promise.resolve();}};
  let sealed=false;
  await assert.rejects(withPreflightBrowser(browser,async b=>{void(await b.newPage()).close();return 'rendered';}).then(()=>{sealed=true;}),error=>error===cleanup);
  assert.equal(sealed,false);assert.deepEqual(events,['page-close','browser-close']);
 }
});
test('clean cleanup drains before browser shutdown and preserves the render result',async()=>{
 const events=[],result={rendered:true};
 const page={async close(){await new Promise(setImmediate);events.push('page-closed');}};
 const browser={async newPage(){return page;},async close(){events.push('browser-closed');}};
 assert.equal(await withPreflightBrowser(browser,async b=>{void(await b.newPage()).close();return result;}),result);
 assert.deepEqual(events,['page-closed','browser-closed']);
});
test('stalled cleanup fails closed and cannot leave a late unhandled rejection',async()=>{
 let rejectClose,closed=false,sealed=false;
 const browser={async newPage(){return{close(){return new Promise((_,reject)=>{rejectClose=reject;});}};},async close(){closed=true;}};
 await assert.rejects(withPreflightBrowser(browser,async b=>{void(await b.newPage()).close();},10).then(()=>{sealed=true;}),/page cleanup timed out/);
 rejectClose(Error('late cleanup'));await new Promise(setImmediate);
 assert.equal(closed,true);assert.equal(sealed,false);
});

test('real-font probe and read-only check bind layout, font, runtime, and complete frames',{skip:!process.env.EP_PREFLIGHT_TEST_RUNTIME&&!process.env.EP_PREFLIGHT_TEST_FONT,timeout:120000},async t=>{
 const {mkdtemp,mkdir,readFile,writeFile,copyFile,access,rm}=await import('node:fs/promises');
 const {default:path}=await import('node:path'),{default:os}=await import('node:os');
 const {execFile}=await import('node:child_process'),{promisify}=await import('node:util');
 const run=promisify(execFile),root=new URL('..',import.meta.url),dir=await mkdtemp(path.join(os.tmpdir(),'ep-title-test-'));
 t.after(()=>rm(dir,{recursive:true,force:true}));
 const runtime=process.env.EP_PREFLIGHT_TEST_RUNTIME,font=process.env.EP_PREFLIGHT_TEST_FONT,p=make();
 async function candidate(name,project,withFont=true){
  const d=path.join(dir,name);await mkdir(path.join(d,'public'),{recursive:true});await writeFile(path.join(d,'project.json'),JSON.stringify(project));
  if(withFont)await copyFile(font,path.join(d,'public/font.ttf'));return d;
 }
 const command=(name,d,...args)=>run(process.execPath,['run.mjs',name,d,'--runtime',runtime,...args],{cwd:root,timeout:100000});
 const d=await candidate('success',p);await command('title-preflight',d);const receipt=JSON.parse(await readFile(path.join(d,'title-preflight.json'),'utf8'));
 assert.deepEqual(receipt.expectedCheckedFrames,preflightFrames(p));await command('title-preflight-check',d);await assert.rejects(command('title-preflight',d),/receipt already exists/);assert.deepEqual(JSON.parse(await readFile(path.join(d,'title-preflight.json'),'utf8')),receipt);
 const final=structuredClone(p);final.id='new-id';final.revision=2;final.director.summary='new notes';final.cuts[0].reason='new reason';
 const finalPath=path.join(dir,'final.json');await writeFile(finalPath,JSON.stringify(final));await command('title-preflight-check',d,'--project',finalPath);
 final.words.at(-1).text='Changed';await writeFile(finalPath,JSON.stringify(final));await assert.rejects(command('title-preflight-check',d,'--project',finalPath));
 const fontPath=path.join(d,'public/font.ttf'),bytes=await readFile(fontPath);await writeFile(fontPath,Buffer.concat([bytes,Buffer.from([0])]));
 await assert.rejects(command('title-preflight-check',d));await writeFile(fontPath,bytes);
 const changedRuntime=path.join(dir,'runtime.json');await writeFile(changedRuntime,(await readFile(runtime,'utf8'))+'\n');
 await assert.rejects(run(process.execPath,['run.mjs','title-preflight-check',d,'--runtime',changedRuntime],{cwd:root}));
 receipt.expectedCheckedFrames.pop();await writeFile(path.join(d,'title-preflight.json'),JSON.stringify(receipt));await assert.rejects(command('title-preflight-check',d));
 const noFont=await candidate('missing',p,false);await assert.rejects(command('title-preflight',noFont));await assert.rejects(access(path.join(noFont,'title-preflight.json')));
 const bad=structuredClone(p);bad.title.bounds.width=180;
 const noFit=await candidate('no-fit',bad);await assert.rejects(command('title-preflight',noFit));await assert.rejects(access(path.join(noFit,'title-preflight.json')));
 const long=structuredClone(p);for(let i=0;i<5;i++)long.words.push({id:'long'+i,text:'Wonderful',start:5+i*.2,end:5.1+i*.2});
 long.captions.push({wordIds:long.words.slice(4).map(w=>w.id)});
 const longDir=await candidate('long-caption',long);await assert.rejects(command('title-preflight',longDir));await assert.rejects(access(path.join(longDir,'title-preflight.json')));
});
