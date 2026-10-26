import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {readFile,readdir,stat} from 'node:fs/promises';
import path from 'node:path';

const hash=async file=>{const h=createHash('sha256');for await(const bytes of createReadStream(file))h.update(bytes);return h.digest('hex');};

// Preserve the runner's existing source/font fingerprint; full toolchain identity is separate.
export async function readRendererIdentity(root,fontFile){
 const sources={};
 for(const folder of [root,path.join(root,'src'),path.resolve(root,'../../12_effect_library/v1/src'),path.resolve(root,'../../12_effect_library/v2/src')]){
  for(const name of await readdir(folder))if(/\.(mjs|tsx|ts)$/.test(name))sources[path.join(folder,name)]=await hash(path.join(folder,name));
 }
 const rendererHash=createHash('sha256').update(JSON.stringify(sources)).update(await hash(fontFile)).digest('hex');
 return {sources,rendererHash};
}

export function createExportAcceptance({dir,root,projectHash,rendererHash}){
 let verifiedFinal=null;
 return async()=>{
  const stale={ready:false,status:'STALE_NEEDS_VERIFICATION'};
  try{
   if(await hash(path.join(dir,'project.json'))!==projectHash)return stale;
   const current=await readRendererIdentity(root,path.join(dir,'public/font.ttf'));
   if(current.rendererHash!==rendererHash)return stale;
   const q=JSON.parse(await readFile(path.join(dir,'qa/final-verification.json'),'utf8'));
   const r=JSON.parse(await readFile(path.join(dir,'render-receipt.json'),'utf8'));
   if(q.status!=='PASS'||q.projectSha256!==projectHash||r.projectHash!==projectHash||q.sha256!==r.sha256||q.rendererHash!==rendererHash||r.rendererHash!==rendererHash)return stale;
   const final=path.join(dir,'final.mp4'),s=await stat(final),identity=`${s.size}:${s.mtimeMs}:${s.ctimeMs}:${q.sha256}`;
   if(verifiedFinal!==identity){if(await hash(final)!==q.sha256)return stale;verifiedFinal=identity;}
   return {ready:true,status:'ACCEPTED'};
  }catch{return stale;}
 };
}
