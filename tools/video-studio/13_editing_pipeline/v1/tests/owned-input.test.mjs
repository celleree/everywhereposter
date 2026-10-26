import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm,symlink} from 'node:fs/promises';import path from 'node:path';import os from 'node:os';
import {checkMedia,verified,hash} from '../owned-input.mjs';
import {validateRuntimeConfig} from '../runtime-preflight.mjs';
import {fixture} from './fixture.mjs';import {validateProject} from '../project.mjs';
test('media validation binds actual original frame count, rate, duration and dimensions',()=>{
 const p={source:{assetId:'source',frames:60},canvas:{fps:30}},a={id:'source',kind:'video',fps:30,duration:2,width:1080,height:1920};
 const m={streams:[{codec_type:'video',codec_name:'h264',width:1080,height:1920,avg_frame_rate:'30/1',duration:'2',nb_frames:'60'}]};
 checkMedia(a,m,p);
 for(const change of [v=>v.nb_frames='59',v=>v.avg_frame_rate='25/1',v=>v.duration='1',v=>v.width=10]){const b=structuredClone(m);change(b.streams[0]);assert.throws(()=>checkMedia(a,b,p));}
 assert.throws(()=>checkMedia({kind:'image'},{streams:[{codec_type:'audio'}]},p));
 assert.throws(()=>checkMedia({kind:'image'},m,p));
});
test('local inputs require real bytes matching explicit SHA and reject links/network paths',async t=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'studio-input-'));t.after(()=>rm(dir,{recursive:true,force:true}));const file=path.join(dir,'owned.dat');await writeFile(file,'owned');
 assert.equal(await verified(file,await hash(file)),file);await assert.rejects(verified(file,'0'.repeat(64)));await assert.rejects(verified('https://example.test/a','0'.repeat(64)));await assert.rejects(verified('\\\\host\\share\\a','0'.repeat(64)));
 const link=path.join(dir,'linked');try{await symlink(file,link)}catch(e){if(['EPERM','EACCES'].includes(e.code))return;throw e}await assert.rejects(verified(link,await hash(file)));
});
test('runtime configuration rejects injected environment, URLs and drive-relative paths',()=>{
 for(const v of [{schemaVersion:1,env:{TOKEN:'x'}},{schemaVersion:1,browserExecutable:'https://example.test/chrome'},{schemaVersion:1,ffmpegExecutable:'C:ffmpeg.exe'},{schemaVersion:1,ffprobeExecutable:'\\\\host\\bin'}])assert.ok(validateRuntimeConfig(v));
});
test('duplicate staging filenames and overlapping profile effects fail closed',()=>{
 const p=fixture();p.assets[1].file=p.assets[0].file;assert.throws(()=>validateProject(p),/unique/);
 const q=fixture();q.profile='easy-graphics-v1';q.effects=[0,1].map(i=>({...q.effects[0],id:`e${i}`,type:'EasyRelationship',props:{theme:'dark',layout:'flow',nodes:[{id:'a',label:'First'},{id:'b',label:'Next'}]}}));assert.throws(()=>validateProject(q),/Overlapping/);
});
