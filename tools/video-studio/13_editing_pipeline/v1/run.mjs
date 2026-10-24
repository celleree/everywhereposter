import {bundle} from '@remotion/bundler';
import {renderMedia,renderStill,selectComposition,openBrowser} from '@remotion/renderer';
import {build} from 'esbuild';
import {createServer} from 'node:http';
import {createReadStream} from 'node:fs';
import {mkdir,readFile,writeFile,stat,access,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {validateProject,chunkContent,assertPreparedProject} from './project.mjs';
const root=path.dirname(fileURLToPath(import.meta.url)),command=process.argv[2],dir=path.resolve(process.argv[3]??'projects/talking-head-v1');
const browserExecutable='/home/arund/cooked-acceptance/.remotion/chrome-headless-shell/linux64/chrome-headless-shell-linux64/chrome-headless-shell';
const hash=async p=>{const h=createHash('sha256');for await(const b of createReadStream(p))h.update(b);return h.digest('hex');};
const exists=async p=>access(p).then(()=>true,()=>false);
const p=JSON.parse(await readFile(path.join(dir,'project.json'),'utf8')),valid=validateProject(p),props={project:p};
for(const a of p.assets)if(await hash(path.join(dir,'public',a.file))!==a.sha256)throw Error(`Changed asset ${a.id}`);
await mkdir(path.join(dir,'qa'),{recursive:true});
const projectHash=await hash(path.join(dir,'project.json'));
const hashes={project:projectHash,audio:await hash(path.join(dir,'public/speech.wav'))};
assertPreparedProject(p,JSON.parse(await readFile(path.join(dir,'prepare-receipt.json'),'utf8')),hashes.audio);
for(const folder of [root,path.join(root,'src'),path.resolve(root,'../../12_effect_library/v1/src'),path.resolve(root,'../../12_effect_library/v2/src')])for(const name of await readdir(folder)){if(/\.(mjs|tsx|ts)$/.test(name))hashes[path.join(folder,name)]=await hash(path.join(folder,name));}
const revisionKey=createHash('sha256').update(JSON.stringify(hashes)).digest('hex');
const rendererHash=createHash('sha256').update(JSON.stringify(Object.fromEntries(Object.entries(hashes).filter(([k])=>!['project','audio'].includes(k))))).update(await hash(path.join(dir,'public/font.ttf'))).digest('hex');
if(command==='validate'){console.log(JSON.stringify({status:'PASS',frames:valid.frames,seconds:valid.seconds,sourceResolution:p.canvas,projectHash}));process.exit(0);}
if(command==='serve'){
 const web=path.join(dir,'player');await mkdir(web,{recursive:true});
 await build({entryPoints:[path.join(root,'src/player.tsx')],bundle:true,format:'iife',outfile:path.join(web,'app.js'),loader:{'.tsx':'tsx'},define:{'process.env.NODE_ENV':'"production"'},jsx:'automatic'});
 const html=`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Everywhere Poster — review your edit</title><style>body{margin:0;background:#101714;color:#fff;font:16px system-ui}main{max-width:620px;margin:auto;padding:24px}header{display:flex;align-items:center;gap:12px;margin-bottom:20px}header img{width:40px;height:40px}header p{margin:4px 0;color:#c0ccc6}.player{max-width:385px;margin:auto;border-radius:16px;overflow:hidden}.note{color:#bdccc5;line-height:1.5;font-size:14px;text-align:center}.download{display:block;text-align:center;background:#a8e5cd;color:#10251c;padding:14px;border-radius:10px;text-decoration:none;font-weight:700;max-width:357px;margin:16px auto}button,a:focus-visible{outline:3px solid #fff;outline-offset:4px}@media(max-width:440px){main{padding:14px}.player{max-width:100%}}</style></head><body><div id="root"></div><script src="/app.js"></script></body></html>`;
 let verifiedFinal=null;
 const acceptedFinal=async()=>{
  if(await hash(path.join(dir,'project.json'))!==projectHash)return false;
  try{const q=JSON.parse(await readFile(path.join(dir,'qa/final-verification.json'),'utf8')),r=JSON.parse(await readFile(path.join(dir,'render-receipt.json'),'utf8')),s=await stat(path.join(dir,'final.mp4'));
   if(q.status!=='PASS'||q.projectSha256!==projectHash||r.projectHash!==projectHash||q.sha256!==r.sha256)return false;
   const identity=`${s.size}:${s.mtimeMs}:${q.sha256}`;
   if(verifiedFinal!==identity){if(await hash(path.join(dir,'final.mp4'))!==q.sha256)return false;verifiedFinal=identity;}
   return true;
  }catch{return false;}
 };
 const server=createServer(async(req,res)=>{try{
  if(!['GET','HEAD'].includes(req.method)){res.writeHead(405).end();return;}
  const u=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
  if(u==='/'){res.writeHead(200,{'content-type':'text/html','cache-control':'no-store'}).end(html);return;}
  if(u==='/status.json'){res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'}).end(JSON.stringify({ready:await acceptedFinal(),projectHash}));return;}
  const publicFiles=new Set(['font.ttf','logo.png','speech.wav',...p.assets.flatMap(a=>[a.file,a.previewFile].filter(Boolean))]);
  const rel=u.slice(1);let file;
  if(rel==='app.js')file=path.join(web,rel);else if(rel==='project.json'){if(await hash(path.join(dir,rel))!==projectHash){res.writeHead(409).end();return;}file=path.join(dir,rel);}else if(rel==='final.mp4'){if(!await acceptedFinal()){res.writeHead(409).end('Export not verified for this project');return;}file=path.join(dir,rel);}else if(publicFiles.has(rel))file=path.join(dir,'public',rel);else{res.writeHead(404).end();return;}
  const s=await stat(file),ext=path.extname(file),types={'.js':'text/javascript','.json':'application/json','.mp4':'video/mp4','.wav':'audio/wav','.png':'image/png','.jpg':'image/jpeg','.ttf':'font/ttf'};
  const headers={'content-type':types[ext]??'application/octet-stream','accept-ranges':'bytes','cache-control':'no-store'};let start=0,end=s.size-1,status=200;
  if(req.headers.range){const m=/^bytes=(\d+)-(\d*)$/.exec(req.headers.range);if(!m||+m[1]>=s.size){res.writeHead(416,{'content-range':`bytes */${s.size}`}).end();return;}start=+m[1];end=m[2]?Math.min(+m[2],end):end;if(end<start){res.writeHead(416).end();return;}status=206;headers['content-range']=`bytes ${start}-${end}/${s.size}`;}
  headers['content-length']=end-start+1;res.writeHead(status,headers);if(req.method==='HEAD'){res.end();return;}createReadStream(file,{start,end}).pipe(res);
 }catch{if(!res.headersSent)res.writeHead(404);res.end();}});
 const port=Number(process.env.EP_PREVIEW_PORT??4381);server.listen(port,'127.0.0.1',()=>console.log(`Preview http://127.0.0.1:${port} — ${projectHash}`));
}else if(['stills','render'].includes(command)){
 const started=Date.now(),serveUrl=await bundle({entryPoint:path.join(root,'src/render.tsx'),publicDir:path.join(dir,'public'),outDir:path.join(dir,'bundle'),enableCaching:true});
 const browser=await openBrowser('chrome',{browserExecutable});
 try{const composition=await selectComposition({serveUrl,id:'DirectedEdit',inputProps:props,browserExecutable,puppeteerInstance:browser});
  if(command==='stills'){
   const frames=[15,...p.broll.map(x=>x.from+20),...p.effects.map(x=>x.from+Math.min(45,x.frames-1)),valid.frames-30];
   for(const frame of frames){const file=path.join(dir,'qa',`frame-${frame}-${rendererHash.slice(0,8)}-${projectHash.slice(0,8)}.png`);if(!await exists(file))await renderStill({serveUrl,composition,inputProps:props,frame,output:file,imageFormat:'png',browserExecutable,puppeteerInstance:browser,overwrite:false});console.log('Still',frame);}
  }else{
   const chunksDir=path.join(root,'render-cache',rendererHash);await mkdir(chunksDir,{recursive:true});const chunks=[];
   const size=20*p.canvas.fps;
   for(let first=0;first<valid.frames;first+=size){const last=Math.min(valid.frames-1,first+size-1),key=createHash('sha256').update(JSON.stringify(chunkContent(p,first,last))).digest('hex'),file=path.join(chunksDir,`${first}-${last}-${key}.mp4`),receipt=file+'.json';
    const reusable=await exists(file)&&await exists(receipt)&&JSON.parse(await readFile(receipt,'utf8')).sha256===await hash(file);
    if(!reusable){if(await exists(file))throw Error('Incomplete chunk exists; preserve it and use a new revision directory');
     let lastProgress=-1;await renderMedia({serveUrl,composition,inputProps:props,frameRange:[first,last],codec:'h264',crf:16,pixelFormat:'yuv420p',imageFormat:'png',muted:true,outputLocation:file,browserExecutable,puppeteerInstance:browser,concurrency:2,overwrite:false,onProgress:({progress})=>{const n=Math.floor(progress*10);if(n!==lastProgress){console.log(`Chunk ${first}-${last}: ${n*10}%`);lastProgress=n;}}});
     execFileSync('ffmpeg',['-v','error','-i',file,'-f','null','-'],{stdio:['ignore','ignore','pipe']});await writeFile(receipt,JSON.stringify({sha256:await hash(file),revisionKey,first,last}));
    }chunks.push(file);
   }
   const list=path.join(dir,'qa',`concat-${revisionKey}.txt`);await writeFile(list,chunks.map(f=>`file '${f.replaceAll("'","'\\''")}'`).join('\n'));
   const final=path.join(dir,'final.mp4');
   execFileSync('ffmpeg',['-v','error','-n','-f','concat','-safe','0','-i',list,'-i',path.join(dir,'public/speech.wav'),'-map','0:v:0','-map','1:a:0','-c:v','copy','-c:a','aac','-b:a','256k','-t',String(valid.seconds),'-movflags','+faststart',final],{stdio:['ignore','ignore','pipe']});
   await writeFile(path.join(dir,'render-receipt.json'),JSON.stringify({status:'RENDERED_QA_PENDING',projectHash,revisionKey,sha256:await hash(final),frames:valid.frames,seconds:valid.seconds,canvas:p.canvas,crf:16,elapsedSeconds:(Date.now()-started)/1000,sources:hashes},null,2));console.log('Render complete',final);
  }
 }finally{await browser.close({silent:true});}
}else throw Error('Use validate, stills, serve or render, followed by a project directory');
