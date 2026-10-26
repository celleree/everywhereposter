import {fileURLToPath} from 'node:url';
import {readFile,realpath,lstat,mkdir,copyFile,writeFile} from 'node:fs/promises';
import path from 'node:path';import {execFileSync} from 'node:child_process';
import {validateProject,audioTimeline} from './project.mjs';
import {hash,json,loadRuntime} from './runtime.mjs';
export {hash} from './runtime.mjs';
export async function verified(file,expected){
 if(typeof file!=='string'||!path.isAbsolute(file)||/^(?:\\\\|\/\/)/.test(file)||!/^([a-f0-9]{64})$/.test(expected??''))throw Error('Unverified local input');
 const s=await lstat(file);if(s.isSymbolicLink()||!s.isFile()||s.size>2*1024**3||await hash(file)!==expected)throw Error('Unverified local input');return realpath(file);
}
export function checkMedia(a,meta,p){
 const v=meta.streams?.find(x=>x.codec_type==='video');if(!v||!v.width||!v.height)throw Error('Asset is not decodable visual media');
 if(a.width!==undefined&&(a.width!==v.width||a.height!==v.height))throw Error('Asset dimensions mismatch');
 if(a.kind==='video'){
  const [n,d]=String(v.avg_frame_rate).split('/').map(Number),fps=n/d,duration=Number(v.duration??meta.format?.duration);
  if(!Number.isFinite(fps)||Math.abs(fps-a.fps)>.001||!Number.isFinite(duration)||Math.abs(duration-a.duration)>1/a.fps+.001)throw Error('Asset clock mismatch');
  if(a.id===p.source.assetId&&(Math.abs(fps-p.canvas.fps)>.001||Number(v.nb_frames)!==p.source.frames))throw Error('Original source must retain its declared frame clock/count');
 }else if(!['png','mjpeg','webp','bmp','tiff'].includes(v.codec_name))throw Error('Use a registered still image, not an animated/video panel');
}
export async function prepareOwned(manifestFile,out,runtimeFile){
 const m=await json(manifestFile),runtime=await loadRuntime(runtimeFile,path.dirname(fileURLToPath(import.meta.url))),p=m.project;
 if(m.schemaVersion!==1||p?.profile!=='easy-graphics-v1'||!['approved-edl','cooked'].includes(m.provenance?.origin))throw Error('Invalid owned-input manifest');
 if(m.provenance.originalSourceSha256!==p.source?.sha256)throw Error('Original source provenance mismatch');
 if(m.provenance.origin==='cooked'){
  if(m.provenance.cooked?.sourceSha256!==p.source.sha256)throw Error('Cooked provenance source mismatch');
  for(const k of ['decisions','captions','receipt']){const ref=m.provenance.cooked[k];await verified(ref?.path,ref?.sha256);}
 }
 if(m.provenance.origin==='approved-edl'&&m.provenance.cooked!==null)throw Error('Do not invent Cooked provenance');
 const valid=validateProject(p),audio=m.inputs?.audio;
 if(JSON.stringify(audio?.timeline)!==JSON.stringify(audioTimeline(p)))throw Error('Unbound audio timeline');
 const records=m.inputs?.assets;
 if(!Array.isArray(records)||records.length!==p.assets.length||new Set(records.map(a=>a.id)).size!==records.length)throw Error('Complete unique asset inputs required');
 const probe=file=>JSON.parse(execFileSync(runtime.ffprobeExecutable,['-v','error','-show_streams','-show_format','-of','json',file],{timeout:15000,maxBuffer:1024*1024}));
 const inputs=[];for(const a of p.assets){const i=records.find(i=>i.id===a.id);if(!i||i.sha256!==a.sha256||a.previewFile)throw Error('Asset binding mismatch or unsupported unbound proxy');const file=await verified(i.path,a.sha256);checkMedia(a,probe(file),p);inputs.push([a,file]);}
 const audioPath=await verified(audio.path,audio.sha256),fontPath=await verified(m.inputs.font.path,m.inputs.font.sha256);
 const audioStream=probe(audioPath).streams.find(s=>s.codec_type==='audio');if(!audioStream||Number(audioStream.duration)<valid.seconds-.001)throw Error('Aligned audio is missing or too short');
 const fontMagic=(await readFile(fontPath)).subarray(0,4).toString('hex');if(!['00010000','4f54544f'].includes(fontMagic))throw Error('Expected a real TTF/OTF font');
 if(m.provenance.proxy!==null&&m.provenance.proxy!==undefined)throw Error('Proxy adaptation is not enabled in this package; submit originals on the source clock');
 if(!path.isAbsolute(runtime.ffmpegExecutable)||!path.isAbsolute(runtime.ffprobeExecutable))throw Error('Explicit absolute media tools required');
 // Atomic mkdir fails for an existing project; no existing project is overwritten.
 await mkdir(out,{recursive:false});await mkdir(path.join(out,'public/assets'),{recursive:true});
 for(const [a,file]of inputs){await copyFile(file,path.join(out,'public',a.file));a.originalPath=file;if(await hash(path.join(out,'public',a.file))!==a.sha256)throw Error('Staging mismatch');}
 await copyFile(fontPath,path.join(out,'public/font.ttf'));
 execFileSync(runtime.ffmpegExecutable,['-v','error','-n','-i',audioPath,'-map','0:a:0','-t',String(valid.seconds),'-c:a','pcm_s32le',path.join(out,'public/speech.wav')],{timeout:120000,maxBuffer:1024*1024});
 const meta=JSON.parse(execFileSync(runtime.ffprobeExecutable,['-v','error','-show_streams','-of','json',path.join(out,'public/speech.wav')],{timeout:15000,maxBuffer:1024*1024}));
 if(Math.abs(Number(meta.streams[0].duration)-valid.seconds)>.001)throw Error('Aligned audio duration mismatch');
 const projectBytes=JSON.stringify(p,null,2)+'\n';await writeFile(path.join(out,'project.json'),projectBytes,{flag:'wx'});
 await writeFile(path.join(out,'prepare-receipt.json'),JSON.stringify({schemaVersion:1,projectId:p.id,revision:p.revision,profile:p.profile,sourceSha256:p.source.sha256,assetHashes:Object.fromEntries(p.assets.map(a=>[a.id,a.sha256])),audioTimeline:audioTimeline(p),audioSha256:await hash(path.join(out,'public/speech.wav')),inputAudioSha256:audio.sha256,fontSha256:m.inputs.font.sha256,manifestSha256:await hash(manifestFile),provenance:m.provenance,audioProcessing:'Decode approved aligned audio only; no EQ, denoise, gain or normalization',runtimeConfigSha256:await hash(runtimeFile)},null,2));
 return {status:'PREPARED',projectId:p.id,revision:p.revision,frames:valid.frames};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{const args=process.argv.slice(2);console.log(JSON.stringify(await prepareOwned(args[0],args[1],args[2])))}catch(e){console.error(e.message);process.exitCode=1;}
}
