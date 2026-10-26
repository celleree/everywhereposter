import {readFile,realpath,stat} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {validateRuntimeConfig} from './runtime-preflight.mjs';
export const hash=async file=>{const h=createHash('sha256');for await(const b of createReadStream(file))h.update(b);return h.digest('hex')};
export async function json(file,limit=8*1024*1024){const s=await stat(file);if(!s.isFile()||s.size>limit)throw Error('Metadata file exceeds limit');return JSON.parse(await readFile(file,'utf8'));}
export async function loadRuntime(file,root){
 const runtime=await json(file,65536),error=validateRuntimeConfig(runtime);if(error)throw Error(error);
 for(const k of ['nodeExecutable','pythonExecutable','browserExecutable','ffmpegExecutable','ffprobeExecutable','nodeModulesRoot','lockfilePath'])if(!path.isAbsolute(runtime[k]??''))throw Error(`Absolute ${k} required`);
 if(await realpath(runtime.nodeExecutable)!==await realpath(process.execPath))throw Error('Running Node differs from configured Node');
 if(await realpath(runtime.nodeModulesRoot)!==await realpath(path.join(root,'node_modules'))||await realpath(runtime.lockfilePath)!==await realpath(path.join(root,'package-lock.json')))throw Error('Use this isolated package node_modules and lockfile');
 return runtime;
}
export async function runtimeIdentity(file,root){
 const runtime=await loadRuntime(file,root),runtimeConfigSha256=await hash(file),toolHashes={};
 for(const k of ['nodeExecutable','pythonExecutable','browserExecutable','ffmpegExecutable','ffprobeExecutable'])toolHashes[k]=await hash(runtime[k]);
 const lock=await json(runtime.lockfilePath),packages={};
 for(const name of ['@remotion/bundler','@remotion/renderer','@remotion/player','remotion','react','react-dom','esbuild']){
  const metadata=await json(path.join(runtime.nodeModulesRoot,name,'package.json'),131072),expected=lock.packages[`node_modules/${name}`]?.version;
  if(metadata.name!==name||metadata.version!==expected)throw Error(`Installed ${name} differs from pinned lock`);packages[name]=metadata.version;
 }
 const lockfileSha256=await hash(runtime.lockfilePath),runtimeHash=createHash('sha256').update(JSON.stringify({runtimeConfigSha256,toolHashes,lockfileSha256,packages})).digest('hex');
 return {runtime,runtimeHash,runtimeConfigSha256,toolHashes,lockfileSha256,packages};
}
