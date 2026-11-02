import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {fixture} from './fixture.mjs';
import {validateProject,PROFILE_CAPABILITY,CAPTION_TIMING_CAPABILITY} from '../project.mjs';
import {validateOwnedTuple} from '../owned-input.mjs';

const v2=()=>{
 const p=fixture();p.schemaVersion=2;p.profile='talking-head-v2';
 p.assets=p.assets.slice(0,1);p.cuts=[{in:0,out:p.source.frames,reason:'Full source'}];
 p.broll=[];p.effects=[];return p;
};
test('profile capability is explicit and caption timing capability is unchanged',()=>{
 const result=JSON.parse(execFileSync(process.execPath,['run.mjs','capabilities'],{cwd:new URL('..',import.meta.url)}));
 assert.deepEqual(result,{captionTiming:{version:1,field:'captionTimingPolicy',default:'legacy-v1',policies:['legacy-v1','trim-trailing-hold-v1']},profiles:{version:1,profiles:[{manifestSchemaVersion:1,projectSchemaVersion:1,profile:'easy-graphics-v1'},{manifestSchemaVersion:2,projectSchemaVersion:2,profile:'talking-head-v2'}]},titlePreflight:{version:1,profile:'talking-head-v2',command:'title-preflight',checkCommand:'title-preflight-check',style:'block-title-v1',fontSize:96,titleMaxLines:2,captionMaxLines:2}});
 assert.deepEqual(result.captionTiming,CAPTION_TIMING_CAPABILITY);assert.deepEqual(result.profiles,PROFILE_CAPABILITY);
});
test('V1 and V2 project identities validate with their matching profiles',()=>{
 const p=fixture();p.profile='easy-graphics-v1';p.effects=[];validateProject(JSON.parse(JSON.stringify(p)));
 validateProject(JSON.parse(JSON.stringify(v2())));
 for(const [schema,profile] of [[1,'talking-head-v2'],[2,'easy-graphics-v1'],[2,undefined],[3,'talking-head-v2'],[1,'unknown']]){
  const q=v2();q.schemaVersion=schema;q.profile=profile;assert.throws(()=>validateProject(q));
 }
});
test('V2 rejects extra tracks, partial cuts, non-source assets and titles',()=>{
 for(const mutate of [
  p=>p.assets.push({...p.assets[0],id:'other',file:'assets/other.mp4'}),
  p=>p.assets[0].kind='image',p=>p.cuts[0].in=1,
  p=>p.cuts.push({...p.cuts[0]}),p=>p.broll.push({}),p=>p.effects.push({}),
  p=>p.title=null,p=>p.titles=[],p=>p.canvas.fps=25,
 ]){const p=v2();mutate(p);assert.throws(()=>validateProject(p));}
});

test('owned-input tuples reject mixed and unknown manifest and project versions',()=>{
 for(const [manifest,project,profile] of [[1,1,'easy-graphics-v1'],[2,2,'talking-head-v2']])validateOwnedTuple({schemaVersion:manifest,project:{schemaVersion:project,profile}});
 for(const [manifest,project,profile] of [[1,2,'talking-head-v2'],[2,1,'easy-graphics-v1'],[2,2,'easy-graphics-v1'],[1,1,undefined],[3,2,'talking-head-v2'],[2,3,'talking-head-v2'],[2,2,'unknown']])assert.throws(()=>validateOwnedTuple({schemaVersion:manifest,project:{schemaVersion:project,profile}}));
});

test('V2 acceptance rejects tampered runtime bindings',async t=>{
 const {mkdtemp,mkdir,writeFile,readFile,rm}=await import('node:fs/promises');
 const {createHash}=await import('node:crypto');
 const {default:path}=await import('node:path'),{default:os}=await import('node:os');
 const {fileURLToPath}=await import('node:url');
 const {readBindings}=await import('../receipt-bindings.mjs');
 const {readRendererIdentity,createExportAcceptance}=await import('../export-acceptance.mjs');
 const hash=b=>createHash('sha256').update(b).digest('hex');
 const root=fileURLToPath(new URL('..',import.meta.url));
 const dir=await mkdtemp(path.join(os.tmpdir(),'v2-bindings-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 await mkdir(path.join(dir,'public/assets'),{recursive:true});await mkdir(path.join(dir,'qa'));
 const p=v2(),source='synthetic source',audio='synthetic audio',font='synthetic font',output='synthetic output';
 const sourcePath=path.join(dir,'source.mp4');p.source.sha256=p.assets[0].sha256=hash(source);p.assets[0].originalPath=sourcePath;
 await writeFile(sourcePath,source);await writeFile(path.join(dir,'public/assets/source.mp4'),source);
 await writeFile(path.join(dir,'public/speech.wav'),audio);await writeFile(path.join(dir,'public/font.ttf'),font);
 const runtime={schemaVersion:1,effectsV1Root:null,effectsV2Root:null,nodeModulesRoot:path.join(root,'node_modules'),lockfilePath:path.join(root,'package-lock.json'),nodeExecutable:process.execPath,pythonExecutable:process.execPath,pythonSitePackagesRoot:null,browserExecutable:process.execPath,ffmpegExecutable:process.execPath,ffprobeExecutable:process.execPath};
 const runtimeFile=path.join(dir,'runtime.json'),runtimeBytes=JSON.stringify(runtime);await writeFile(runtimeFile,runtimeBytes);
 const projectBytes=JSON.stringify(p);await writeFile(path.join(dir,'project.json'),projectBytes);
 await writeFile(path.join(dir,'prepare-receipt.json'),JSON.stringify({projectId:p.id,revision:p.revision,profile:p.profile,sourceSha256:p.source.sha256,assetHashes:{source:p.source.sha256},fontSha256:hash(font),audioSha256:hash(audio),audioTimeline:{sourceSha256:p.source.sha256,fps:p.canvas.fps,cuts:[[0,p.source.frames]]},runtimeConfigSha256:hash(runtimeBytes)}));
 await writeFile(path.join(dir,'final.mp4'),output);
 const bindings=await readBindings(dir,runtimeFile),{rendererHash}=await readRendererIdentity(root,path.join(dir,'public/font.ttf'),p.profile),projectHash=hash(projectBytes),sha256=hash(output);
 const r={projectHash,rendererHash,sha256,bindings},q={status:'PASS',projectSha256:projectHash,rendererHash,sha256,bindings};
 const save=async()=>{await writeFile(path.join(dir,'render-receipt.json'),JSON.stringify(r));await writeFile(path.join(dir,'qa/final-verification.json'),JSON.stringify(q));};
 await save();const check=createExportAcceptance({dir,root,projectHash,rendererHash,profile:p.profile,runtimeFile});
 assert.deepEqual(await check(),{ready:true,status:'ACCEPTED'});
 r.bindings={...bindings,runtimeHash:'0'.repeat(64)};await save();
 assert.deepEqual(await check(),{ready:false,status:'STALE_NEEDS_VERIFICATION'});
 r.bindings=bindings;q.bindings={...bindings,runtimeConfigSha256:'0'.repeat(64)};await save();
 assert.deepEqual(await check(),{ready:false,status:'STALE_NEEDS_VERIFICATION'});
});
