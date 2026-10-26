import {test} from 'node:test';
import assert from 'node:assert/strict';
import {SAFE_ZONE_PROFILES,selectProfiles,ALL_ADVERTISED_PRESET} from '../safe-zone-profiles.mjs';
import {intersectProfiles,coverage,checkContentBounds,checkFocalRegion,coverRegion,planCaption,assertMeasuredCaption,usableRectangles} from '../safe-zones.mjs';

const known=['linkedin-organic-v1','pinterest-organic-v1','tiktok-ad-derived-v1','youtube-ad-derived-v1'];
const region=ids=>intersectProfiles(selectProfiles({profiles:ids}));
const four=region(known);
const rect=(x,y,w,h)=>[[x/1080,y/1920],[(x+w)/1080,y/1920],[(x+w)/1080,(y+h)/1920],[x/1080,(y+h)/1920]];
// Deliberately synthetic metrics: these tests are not font-measured render acceptance.
const measure=text=>({width:text.length*29,left:2,right:text.length*29+1,ascent:56,descent:14});

test('reference geometry retains official versus ad-derived provenance',()=>{
 const byId=new Map(SAFE_ZONE_PROFILES.map(p=>[p.id,p]));
 assert.deepEqual(byId.get('pinterest-organic-v1').referencePoints,[[65,270],[885,270],[885,1130],[65,1130]]);
 assert.deepEqual(byId.get('linkedin-organic-v1').referencePoints,[[112,260],[870,260],[870,1360],[112,1360]]);
 assert.equal(byId.get('tiktok-ad-derived-v1').confidence,'ad-derived');
 assert.equal(byId.get('youtube-ad-derived-v1').confidence,'ad-derived');
 assert.equal(byId.get('tiktok-ad-derived-v1').polygon.length,6);
 assert.ok(SAFE_ZONE_PROFILES.every(p=>p.version===1&&p.checkedAt==='2026-10-24'&&Object.isFrozen(p.polygon)));
});
test('remaining advertised destinations have separate provisional identities',()=>{
 assert.deepEqual(SAFE_ZONE_PROFILES.filter(p=>p.confidence==='provisional').map(p=>p.platform).sort(),['dribbble','facebook','instagram','reddit','threads','x']);
 assert.match(SAFE_ZONE_PROFILES.find(p=>p.platform==='dribbble').note,/eligibility.*separate/i);
 assert.equal(selectProfiles({preset:ALL_ADVERTISED_PRESET}).length,10);
});
test('missing, duplicate, unversioned or unknown selections never silently become all-platform protection',()=>{
 for(const config of [{},{profiles:[]},{profiles:['linkedin']},{profiles:['unknown-v1']},{profiles:['linkedin-organic-v1','linkedin-organic-v1']},{preset:'all'},{preset:ALL_ADVERTISED_PRESET,profiles:known}])assert.throws(()=>selectProfiles(config));
});
test('selected four-profile intersection preserves the usable upper notch',()=>{
 assert.equal(coverage(rect(820,500,40,40),four),1);
 assert.equal(coverage(rect(820,900,40,40),four),0);
 assert.ok(Math.abs(coverage(rect(130,1120,100,20),four)-.5)<1e-9);
 assert.ok(usableRectangles(four).some(r=>Math.abs(r.width*1080-750)<1e-8));
 assert.deepEqual(intersectProfiles(selectProfiles({profiles:[...known].reverse()})),four);
});
test('Pinterest changes the selected intersection without narrowing an unrelated selection',()=>{
 const linked=region(['linkedin-organic-v1']),pin=region(['pinterest-organic-v1']);
 assert.equal(coverage(rect(130,1200,100,100),linked),1);
 assert.equal(coverage(rect(130,1200,100,100),pin),0);
 assert.equal(coverage(rect(80,300,20,20),pin),1);
 assert.equal(coverage(rect(80,300,20,20),linked),0);
});
for(const [width,height]of [[720,1280],[1080,1920],[2160,3840]])test(`normalized boundaries scale consistently at ${width}x${height}`,()=>{
 const pixels=four.map(r=>({x:r.x*width,y:r.y*height,width:r.width*width,height:r.height*height}));
 assert.equal(Math.min(...pixels.map(r=>r.x)),width/9);
 assert.ok(Math.abs(Math.max(...pixels.map(r=>r.y+r.height))-1130/1920*height)<1e-8);
 const normalized=pixels.map(r=>({x:r.x/width,y:r.y/height,width:r.width/width,height:r.height/height}));
 assert.ok(coverage(rect(820,500,40,40),normalized)>1-1e-10);
 assert.equal(coverage(rect(820,900,40,40),normalized),0);
});
test('whole critical polygon must fit, even when each corner fits a concave mask',()=>{
 const points=[[740,800],[850,820],[770,950],[700,900]];
 for(const [x,y]of points)assert.equal(checkContentBounds(rect(x,y,1,1),four).valid,true);
 const quad=points.map(([x,y])=>[x/1080,y/1920]);
 assert.equal(checkContentBounds(quad,four,'critical').valid,false);
 assert.equal(checkContentBounds(quad,four,'decorative').valid,true);
});
test('motion endpoints inside the region cannot certify an outlying animation extremum',()=>{
 const envelopes=[rect(160,400,100,50),rect(950,400,100,50),rect(160,400,100,50)];
 assert.equal(envelopes.every(p=>checkContentBounds(p,four).valid),false);
});
test('an empty selected intersection is an error instead of dropping a destination',()=>{
 assert.throws(()=>intersectProfiles([{polygon:[[0,0],[.2,0],[.2,1],[0,1]]},{polygon:[[.8,0],[1,0],[1,1],[.8,1]]}]),/no common usable area/);
});
test('95 percent is a per-region warning, including zero safe coverage while still visible',()=>{
 assert.equal(checkFocalRegion(rect(130,1100,100,100),four,true).status,'WARNING');
 assert.equal(checkFocalRegion(rect(130,1500,100,100),four,true).status,'WARNING');
 const regions=[rect(200,500,100,100),rect(130,1500,100,100)].map(p=>checkFocalRegion(p,four,true));
 assert.deepEqual(regions.map(r=>r.status),['WITHIN_TARGET','WARNING']);
});
test('a crop cannot hide complete loss of an essential action region',()=>{
 const mapped=coverRegion({x:0,y:.2,width:.05,height:.1},{width:1920,height:1080},{width:1080,height:1920});
 assert.equal(checkFocalRegion(mapped,four,true).visibleCoverage,0);
 assert.equal(checkFocalRegion(mapped,four,true).status,'ERROR');
 assert.equal(checkFocalRegion(mapped,four,false).status,'WARNING');
});
test('long captions reflow at readable size while retaining every word',()=>{
 const words=['Preserve','meaningful','keyboard','movement','without','dropping','spoken','words'];
 const layout=planCaption(words,four,measure);
 assert.ok(layout.lines.length>1);
 assert.equal(layout.lines.map(l=>l.text).join(' '),words.join(' '));
 assert.equal(layout.fontSize,76);
 for(const line of layout.lines)assert.equal(checkContentBounds(rect(line.ink.x,line.ink.y,line.ink.width,line.ink.height),four).valid,true);
});
test('layout can use upper width that a narrow universal rectangle would discard',()=>{
 const layout=planCaption(['ABCDEFGHIJKLMNOPQRSTUVWX'],four,measure);
 assert.ok(layout.box.width>700);
 assert.ok(layout.box.y+layout.box.height<=840+1e-8);
});
test('layout avoids observed face obstacles without changing words',()=>{
 const obstacle={x:120,y:900,width:750,height:230};
 const layout=planCaption(['Keep','the','speaker','visible'],four,measure,[obstacle]);
 assert.ok(layout.box.y+layout.box.height<=obstacle.y);
 assert.equal(layout.lines.map(l=>l.text).join(' '),'Keep the speaker visible');
});
test('unfittable words and unavailable actual metrics fail rather than shrink/drop text',()=>{
 assert.throws(()=>planCaption(['x'.repeat(100)],four,measure),/no words dropped/);
 assert.throws(()=>planCaption(['Word'],four,()=>({width:100})),/actual font metrics/);
});
test('actual glyph/stroke measurement rejects overflow beyond a nominal planned box',()=>{
 assert.doesNotThrow(()=>assertMeasuredCaption({x:120,y:900},[{x:5,y:5,width:200,height:60}],four));
 assert.throws(()=>assertMeasuredCaption({x:120,y:900},[{x:0,y:5,width:200,height:60}],four),/stroke/);
 assert.throws(()=>assertMeasuredCaption({x:120,y:900},[{x:5,y:5,width:800,height:60}],four),/exceeds/);
 assert.throws(()=>assertMeasuredCaption({x:120,y:900},[],four),/No measured/);
});
