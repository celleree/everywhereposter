import {createHash} from 'node:crypto';
import {copyFile,lstat,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {bundle} from '@remotion/bundler';
import {openBrowser,renderStill,selectComposition} from '@remotion/renderer';
import {captionTimingPolicy,validateProject} from './project.mjs';
import {readRendererIdentity} from './export-acceptance.mjs';
import {hash,runtimeIdentity} from './runtime.mjs';
import {ACCEPTED_STYLE,ACCEPTED_FONTS} from './accepted-style.mjs';

export const TITLE_PREFLIGHT_CAPABILITY=Object.freeze({version:1,profile:'talking-head-v2',command:'title-preflight',checkCommand:'title-preflight-check',style:'block-title-v1',fontSize:96,titleMaxLines:2,captionMaxLines:2});
const stable=value=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,stable(value[k])])):value;
export function layoutProjection(p){
 return {...(p.editorStyle?{editorStyle:p.editorStyle}:{}),schemaVersion:p.schemaVersion,profile:p.profile,canvas:p.canvas,source:{assetId:p.source.assetId,sha256:p.source.sha256,frames:p.source.frames,...(p.source.originalFrames?{originalFrames:p.source.originalFrames}:{})},cuts:p.cuts.map(({in:i,out})=>({in:i,out})),words:p.words.map(({id,text,start,end})=>({id,text,start,end})),captions:p.captions.map(({wordIds})=>({wordIds})),captionTimingPolicy:captionTimingPolicy(p),speakerFaces:p.speaker.faces.map(({t,x,y,width,height})=>({t,x,y,width,height})),safeZones:p.safeZones,title:p.title};
}
export function layoutInputHash(p){return createHash('sha256').update('EP_TITLE_LAYOUT_INPUT_V1\n').update(JSON.stringify(stable(layoutProjection(p)))).digest('hex');}
export function preflightFrames(p){
 const v=validateProject(p);
 if(p.profile!=='talking-head-v2'||!p.title||p.canvas.width!==1080||p.canvas.height!==1920||p.canvas.fps!==30||v.frames>(p.editorStyle===ACCEPTED_STYLE?1801:1800))throw Error('Preflight requires a bounded 1080x1920 talking-head-v2 title project');
 const seen=new Set(),visible=new Set(),frames=[];
 for(let frame=0;frame<v.frames;frame++){
  const index=v.captionRanges.findIndex(([from,end])=>frame>=from&&frame<end);
  if(index>=0)visible.add(index);
  const title=frame>=p.title.from&&frame<p.title.from+p.title.frames;
  if(index<0&&!title)continue;
  const key=index+':'+title;
  if(!seen.has(key)){seen.add(key);frames.push(frame);if(frames.length>128)throw Error('Title preflight exceeds 128 layout states');}
 }
 if(visible.size!==p.captions.length)throw Error('Every caption group must have visible frames');
 return frames;
}
async function bounded(file,max){
 const info=await lstat(file);
 if(!info.isFile()||info.isSymbolicLink()||info.size<1||info.size>max)throw Error('Missing or unbounded preflight input');
 return readFile(file);
}
async function current({dir,root,runtimeFile,projectFile}){
 const p=JSON.parse(await bounded(projectFile,8*1024*1024)),expectedCheckedFrames=preflightFrames(p);
 const fontFile=path.join(dir,'public/font.ttf'),font=await bounded(fontFile,32*1024*1024);
 if(!['00010000','4f54544f'].includes(font.subarray(0,4).toString('hex')))throw Error('Expected local TTF/OTF font');
 const fontSha256=createHash('sha256').update(font).digest('hex');
 const headlineFontSha256=p.editorStyle===ACCEPTED_STYLE?await hash(path.join(dir,'public/headline-font.ttf')):undefined;
 if(p.editorStyle===ACCEPTED_STYLE&&(fontSha256!==ACCEPTED_FONTS.caption.sha256||headlineFontSha256!==ACCEPTED_FONTS.headline.sha256))throw Error('Approved fonts differ from the selected reference');
 const {rendererHash}=await readRendererIdentity(root,fontFile,p.profile);
 const {runtime,...identity}=await runtimeIdentity(runtimeFile,root);
 return {p,fontFile,fontSha256,runtime,receipt:{schemaVersion:1,kind:'TITLE_LAYOUT_PREFLIGHT',status:'PASS',layoutInputHash:layoutInputHash(p),fontSha256,...(headlineFontSha256?{headlineFontSha256}:{}),rendererHash,...identity,expectedCheckedFrames}};
}
export async function checkTitlePreflight({dir,root,runtimeFile,projectFile=path.join(dir,'project.json')}){
 const {receipt}=await current({dir,root,runtimeFile,projectFile});
 const saved=JSON.parse(await bounded(path.join(dir,'title-preflight.json'),1024*1024));
 if(JSON.stringify(stable(saved))!==JSON.stringify(stable(receipt)))throw Error('Title preflight receipt missing, incomplete or stale');
 return saved;
}
// The app freezes these measured groups before direction or a paid request.
// This uses the same browser, actual fonts and measurement as preview/export.
export async function measureAcceptedCaptions({dir,root,runtimeFile}){
 const p=JSON.parse(await bounded(path.join(dir,'project.json'),8*1024*1024));validateProject(p);
 if(p.editorStyle!==ACCEPTED_STYLE)throw Error('Approved caption planning requires its explicit style');
 for(const [kind,name]of [['caption','font.ttf'],['headline','headline-font.ttf']])if(await hash(path.join(dir,'public',name))!==ACCEPTED_FONTS[kind].sha256)throw Error('Approved font mismatch');
 const {runtime}=await runtimeIdentity(runtimeFile,root),temp=await mkdtemp(path.join(os.tmpdir(),'ep-caption-plan-'));
 let groups;
 try{
  const serveUrl=await bundle({webpackOverride:c=>({...c,resolve:{...c.resolve,modules:[runtime.nodeModulesRoot,'node_modules']}}),entryPoint:path.join(root,'src/render.tsx'),publicDir:path.join(dir,'public'),outDir:path.join(temp,'bundle'),enableCaching:true});
  const browser=await openBrowser('chrome',{browserExecutable:runtime.browserExecutable});
  await withPreflightBrowser(browser,async()=>{
   const inputProps={project:p,layoutOnly:true,captionPlanOnly:true},composition=await selectComposition({serveUrl,id:'DirectedEdit',inputProps,browserExecutable:runtime.browserExecutable,puppeteerInstance:browser});
   await renderStill({serveUrl,composition,inputProps,frame:0,output:path.join(temp,'plan.png'),imageFormat:'png',browserExecutable:runtime.browserExecutable,puppeteerInstance:browser,onBrowserLog:log=>{if(log.text.startsWith('EP_ACCEPTED_CAPTIONS:'))groups=JSON.parse(log.text.slice('EP_ACCEPTED_CAPTIONS:'.length));}});
  });
  if(!Array.isArray(groups)||JSON.stringify(groups.flatMap(g=>g.wordIds))!==JSON.stringify(p.words.map(w=>w.id)))throw Error('Measured captions must preserve every word once');
  return groups;
 }finally{await rm(temp,{recursive:true,force:true});}
}
// Remotion starts page cleanup without awaiting it after a render error.
// Return consumed close promises to the SDK, drain them while Chrome is alive,
// and propagate cleanup-only failures before any PASS receipt can be written.
export async function withPreflightBrowser(browser,render,cleanupTimeoutMs=5000){
 const pending=new Set(),errors=[],restores=[];
 let failed=false,primary,result;
 const originalNewPage=browser.newPage,owned=Object.hasOwn(browser,'newPage');
 try{
  browser.newPage=async(...args)=>{
   const page=await originalNewPage.apply(browser,args),close=page.close,ownedClose=Object.hasOwn(page,'close');
   let closing;
   page.close=(...options)=>{
    if(!closing){
     let timer;
     const operation=Promise.resolve().then(()=>close.apply(page,options));
     closing=Promise.race([operation,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Title preflight page cleanup timed out')),cleanupTimeoutMs);})])
      .catch(error=>{errors.push(error);})
      .finally(()=>{clearTimeout(timer);pending.delete(closing);});
     pending.add(closing);
    }
    return closing;
   };
   restores.push(()=>{if(ownedClose)page.close=close;else delete page.close;});
   return page;
  };
  result=await render(browser);
 }catch(error){failed=true;primary=error;}
 finally{
  // Includes synchronous throws, asynchronous rejections and duplicate closes.
  while(pending.size)await Promise.all([...pending]);
  try{await browser.close({silent:true});}catch(error){errors.push(error);}
  for(const restore of restores.reverse())restore();
  if(owned)browser.newPage=originalNewPage;else delete browser.newPage;
 }
 if(failed)throw primary;
 if(errors.length)throw errors[0];
 return result;
}
export async function runTitlePreflight({dir,root,runtimeFile}){
 const projectFile=path.join(dir,'project.json'),receiptFile=path.join(dir,'title-preflight.json');
 try{await lstat(receiptFile);throw Error('Title preflight receipt already exists');}catch(e){if(e.code!=='ENOENT')throw e;}
 const initial=await current({dir,root,runtimeFile,projectFile});
 const temp=await mkdtemp(path.join(os.tmpdir(),'ep-title-preflight-'));
 try{
  const publicDir=path.join(temp,'public');await import('node:fs/promises').then(fs=>fs.mkdir(publicDir));
  await copyFile(initial.fontFile,path.join(publicDir,'font.ttf'));
  if(initial.p.editorStyle===ACCEPTED_STYLE)await copyFile(path.join(dir,'public/headline-font.ttf'),path.join(publicDir,'headline-font.ttf'));
  if(await hash(path.join(publicDir,'font.ttf'))!==initial.fontSha256)throw Error('Preflight font changed while staging');
  const serveUrl=await bundle({webpackOverride:c=>({...c,resolve:{...c.resolve,modules:[initial.runtime.nodeModulesRoot,'node_modules']}}),entryPoint:path.join(root,'src/render.tsx'),publicDir,outDir:path.join(temp,'bundle'),enableCaching:true});
  const browser=await openBrowser('chrome',{browserExecutable:initial.runtime.browserExecutable});
  await withPreflightBrowser(browser,async()=>{
   const inputProps={project:initial.p,layoutOnly:true},composition=await selectComposition({serveUrl,id:'DirectedEdit',inputProps,browserExecutable:initial.runtime.browserExecutable,puppeteerInstance:browser});
   for(const frame of initial.receipt.expectedCheckedFrames)await renderStill({serveUrl,composition,inputProps,frame,output:path.join(temp,'frame-'+frame+'.png'),imageFormat:'png',browserExecutable:initial.runtime.browserExecutable,puppeteerInstance:browser,overwrite:false});
  });
  const final=await current({dir,root,runtimeFile,projectFile});
  if(JSON.stringify(stable(final.receipt))!==JSON.stringify(stable(initial.receipt)))throw Error('Preflight inputs changed during rendering');
  await writeFile(receiptFile,JSON.stringify(initial.receipt,null,2)+'\n',{flag:'wx'});
  return initial.receipt;
 }finally{await rm(temp,{recursive:true,force:true});}
}
