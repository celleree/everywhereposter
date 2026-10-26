import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fixture} from './fixture.mjs';
import {validateProject,chunkContent,audioTimeline} from '../project.mjs';
import {assertSafeZoneRender,planCaption} from '../safe-zones.mjs';
import {readRendererIdentity} from '../export-acceptance.mjs';

const aware=()=>{const p=fixture();p.effects=[];p.safeZones={version:1,profiles:['pinterest-organic-v1']};return p;};
test('legacy projects remain unchanged and explicitly unassessed',()=>{
 const p=fixture(),before=structuredClone(p),v=validateProject(p);
 assert.equal(v.safeZones.status,'UNASSESSED');assert.deepEqual(p,before);
 assert.doesNotThrow(()=>assertSafeZoneRender(v.safeZones));
});
test('aware projects require named profiles or the visibly provisional preset',()=>{
 for(const value of [{version:1},{version:1,profiles:[]},{version:2,profiles:['pinterest-organic-v1']},{version:1,profiles:['pinterest-organic-v1'],effectsVerified:true}]){
  const p=aware();p.safeZones=value;assert.throws(()=>validateProject(p));
 }
 const p=aware();p.safeZones={version:1,preset:'all-advertised-provisional-v1'};
 const result=validateProject(p).safeZones;
 assert.equal(result.profiles.length,10);assert.equal(result.findings.filter(x=>x.code==='PROFILE_NOT_OFFICIAL_ORGANIC').length,8);
});
test('private effect geometry is not certified by caller-supplied bounds',()=>{
 const p=fixture();p.safeZones={version:1,profiles:['linkedin-organic-v1']};
 const result=validateProject(p).safeZones;
 assert.equal(result.status,'CRITICAL_CONTENT_UNVERIFIED');
 assert.throws(()=>assertSafeZoneRender(result),/UNVERIFIED_CRITICAL_EFFECT_BOUNDS:e1/);
});
test('unknown focal metadata remains a warning and never invents a crop/detector result',()=>{
 const p=aware(),before=structuredClone(p),result=validateProject(p).safeZones;
 assert.equal(result.findings.filter(x=>x.code==='FOCAL_COVERAGE_UNASSESSED').length,2);
 assert.doesNotThrow(()=>assertSafeZoneRender(result));assert.deepEqual(p,before);
});
test('focal regions are bound to their asset track, timing and normalized source coordinates',()=>{
 const p=aware();p.assets[0].width=1440;p.assets[0].height=2560;
 const f={id:'hands',track:'source',from:0,frames:100,rect:{x:.3,y:.85,width:.2,height:.1},essential:true};
 p.safeZones.focalRegions=[f];
 const result=validateProject(p).safeZones;
 assert.equal(result.findings.find(x=>x.region==='hands').severity,'warning');assert.doesNotThrow(()=>assertSafeZoneRender(result));
 for(const change of [{track:'missing'},{from:-1},{frames:99999},{rect:{x:-.1,y:.1,width:.2,height:.2}},{essential:'true'}]){
  const copy=structuredClone(p);Object.assign(copy.safeZones.focalRegions[0],change);assert.throws(()=>validateProject(copy),/focal region/);
 }
});
test('known essential content fully removed by cover crop is a hard failure',()=>{
 const p=aware(),asset=p.assets.find(a=>a.id==='broll');asset.width=1920;asset.height=1080;
 p.safeZones.focalRegions=[{id:'keyboard',track:'b1',from:1200,frames:60,rect:{x:0,y:.2,width:.05,height:.1},essential:true}];
 const result=validateProject(p).safeZones;
 assert.throws(()=>assertSafeZoneRender(result),/ESSENTIAL_FOCAL_CONTENT_FULLY_CROPPED/);
});
test('known full-frame B-roll occlusion of an essential source region is a hard failure',()=>{
 const p=aware();p.assets[0].width=1440;p.assets[0].height=2560;
 p.safeZones.focalRegions=[{id:'hands',track:'source',from:1190,frames:80,rect:{x:.3,y:.3,width:.1,height:.1},essential:true}];
 const result=validateProject(p).safeZones;
 const occlusion=result.findings.find(x=>x.code==='ESSENTIAL_FOCAL_CONTENT_FULLY_OCCLUDED');
 assert.deepEqual(occlusion,{severity:'error',code:'ESSENTIAL_FOCAL_CONTENT_FULLY_OCCLUDED',region:'hands',event:'b1',from:1200,frames:60});
 assert.throws(()=>assertSafeZoneRender(result),/ESSENTIAL_FOCAL_CONTENT_FULLY_OCCLUDED/);
 delete p.assets[0].width;
 assert.throws(()=>assertSafeZoneRender(validateProject(p).safeZones),/ESSENTIAL_FOCAL_CONTENT_FULLY_OCCLUDED/);
});
test('source occlusion warns for nonessential regions and does not extend past B-roll timing',()=>{
 const p=aware();p.assets[0].width=1440;p.assets[0].height=2560;
 p.safeZones.focalRegions=[{id:'hands',track:'source',from:1200,frames:60,rect:{x:.3,y:.3,width:.1,height:.1},essential:false}];
 const result=validateProject(p).safeZones;
 assert.equal(result.findings.find(x=>x.code==='FOCAL_CONTENT_OCCLUDED_BY_BROLL').severity,'warning');
 assert.doesNotThrow(()=>assertSafeZoneRender(result));
 for(const from of [1140,1260]){
  Object.assign(p.safeZones.focalRegions[0],{from,essential:true});
  assert.doesNotThrow(()=>assertSafeZoneRender(validateProject(p).safeZones));
 }
});
test('missing dimensions are unassessed rather than guessed from a whole overlay',()=>{
 const p=aware();p.safeZones.focalRegions=[{id:'keyboard',track:'b1',from:1200,frames:60,rect:{x:.4,y:.4,width:.1,height:.1},essential:true}];
 const result=validateProject(p).safeZones;
 assert.equal(result.findings.find(x=>x.region==='keyboard').code,'FOCAL_DIMENSIONS_UNASSESSED');assert.doesNotThrow(()=>assertSafeZoneRender(result));
});
test('caption reflow preserves original word identity, timing, cuts and prepared speech clock',()=>{
 const p=aware(),before=structuredClone(p),clock=audioTimeline(p),result=validateProject(p);
 for(const c of p.captions){
  const words=c.wordIds.map(id=>result.words.get(id).text);
  const caption=planCaption(words,result.safeZones.cells,t=>({width:t.length*25,left:0,right:t.length*25,ascent:55,descent:15}));
  assert.equal(caption.lines.map(l=>l.text).join(' '),words.join(' '));
 }
 assert.deepEqual(p,before);assert.deepEqual(audioTimeline(p),clock);
});
test('changed targets and geometry metadata invalidate cached content; editorial notes do not',()=>{
 const p=aware(),first=JSON.stringify(chunkContent(p,0,599));
 p.safeZones.profiles=['linkedin-organic-v1'];assert.notEqual(JSON.stringify(chunkContent(p,0,599)),first);
 p.safeZones.profiles=['pinterest-organic-v1'];p.speaker.faces[0].x+=10;
 assert.notEqual(JSON.stringify(chunkContent(p,0,599)),first);
 p.speaker.faces[0].x-=10;p.director.summary='An updated editorial explanation';
 assert.equal(JSON.stringify(chunkContent(p,0,599)),first);
});
test('profile-module changes enter the existing renderer identity without modifying receipts',async t=>{
 const temp=await mkdtemp(path.join(tmpdir(),'ep-safezone-identity-'));
 assert.equal(path.dirname(temp),path.resolve(tmpdir()));
 t.after(()=>rm(temp,{recursive:true,force:true}));
 const root=path.join(temp,'13_editing_pipeline','v1');
 for(const folder of [root,path.join(root,'src'),path.join(temp,'12_effect_library','v1','src'),path.join(temp,'12_effect_library','v2','src')])await mkdir(folder,{recursive:true});
 const font=path.join(temp,'font.ttf');await writeFile(font,'synthetic-font-bytes');
 const file=path.join(root,'safe-zone-profiles.mjs');await writeFile(file,'// synthetic version 1');
 const old=await readRendererIdentity(root,font);await writeFile(file,'// synthetic version 2');
 const next=await readRendererIdentity(root,font);assert.notEqual(next.rendererHash,old.rendererHash);
});
