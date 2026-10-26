import path from 'node:path';import {fileURLToPath} from 'node:url';
import {hash,json,runtimeIdentity} from './runtime.mjs';
import {validateProject,assertPreparedProject} from './project.mjs';
import {readRendererIdentity} from './export-acceptance.mjs';
export async function readBindings(dir,runtimeFile){
 const root=path.dirname(fileURLToPath(import.meta.url)),p=await json(path.join(dir,'project.json'));validateProject(p);
 const prepared=await json(path.join(dir,'prepare-receipt.json')),audioSha256=await hash(path.join(dir,'public/speech.wav')),fontSha256=await hash(path.join(dir,'public/font.ttf'));
 assertPreparedProject(p,prepared,audioSha256);
 const assetHashes={};for(const a of p.assets){const value=await hash(path.join(dir,'public',a.file));if(value!==a.sha256||await hash(a.originalPath)!==a.sha256)throw Error(`Changed asset ${a.id}`);assetHashes[a.id]=value;}
 if(prepared.projectId!==p.id||prepared.revision!==p.revision||prepared.profile!==p.profile||prepared.fontSha256!==fontSha256||prepared.sourceSha256!==p.source.sha256||JSON.stringify(prepared.assetHashes)!==JSON.stringify(assetHashes))throw Error('Preparation identity mismatch');
 const {runtime:_,...identity}=await runtimeIdentity(runtimeFile,root);
 if(prepared.runtimeConfigSha256!==identity.runtimeConfigSha256)throw Error('Runtime configuration differs from preparation');
 const {rendererHash}=await readRendererIdentity(root,path.join(dir,'public/font.ttf'),p.profile);
 return {projectId:p.id,revision:p.revision,profile:p.profile,projectHash:await hash(path.join(dir,'project.json')),prepareReceiptSha256:await hash(path.join(dir,'prepare-receipt.json')),sourceSha256:p.source.sha256,assetHashes,fontSha256,audioSha256,audioTimeline:prepared.audioTimeline,rendererHash,...identity};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){try{console.log(JSON.stringify(await readBindings(path.resolve(process.argv[2]),path.resolve(process.argv[3]))))}catch(e){console.error(e.message);process.exitCode=1}}
