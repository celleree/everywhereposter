import test from 'node:test';
import assert from 'node:assert/strict';
import {validateProject,chunkContent} from '../project.mjs';
import {planTitle,assertMeasuredTitle,titleForCaption} from '../title-layout.mjs';
import {fixture} from './fixture.mjs';
const metric=text=>({width:text.length*45,left:0,right:text.length*45,ascent:70,descent:20});
const make=()=>{
 const p=fixture();p.schemaVersion=2;p.profile='talking-head-v2';p.assets=p.assets.slice(0,1);
 p.cuts=[{in:0,out:p.source.frames,reason:'whole source'}];p.effects=[];p.broll=[];
 p.safeZones={version:1,profiles:['linkedin-organic-v1']};
 p.title={version:1,text:p.words.slice(0,3).map(w=>w.text).join(' '),wordIds:p.words.slice(0,3).map(w=>w.id),from:100,frames:60,bounds:{x:120,y:270,width:740,height:220},style:'block-title-v1'};return p;
};
test('source anchored title validates and rejects malformed, invented and unsafe titles',()=>{
 const p=make();validateProject(p);
 for(const f of [
  p=>p.title.text='Invented text',p=>p.title.wordIds=['w0','w2','w3'],p=>p.title.wordIds=['w0','w1'],
  p=>p.title.version=2,p=>p.title.extra=true,p=>p.title.bounds.extra=true,p=>p.title.text=null,p=>p.title.from='100',p=>p.title.style='unknown',p=>p.title.from=-1,p=>p.title.frames=59,p=>p.title.frames=121,
  p=>p.title.bounds.x=-1,p=>p.title.bounds.y=769,p=>p.title.bounds.width=1100,
  p=>{p.title.bounds={x:300,y:300,width:400,height:220};p.speaker.faces[0].t=4;},p=>delete p.safeZones,
 ]){const q=structuredClone(p);f(q);assert.throws(()=>validateProject(q));}
 const q=structuredClone(p);q.schemaVersion=1;q.profile='easy-graphics-v1';assert.throws(()=>validateProject(q));
});
test('fixed-size font layout refuses missing metrics, overflow, and more than two lines',()=>{
 const box={x:0,y:0,width:880,height:260},layout=planTitle('Short title words',box,metric);
 assert.equal(layout.fontSize,96);assert.ok(layout.lines.length<=2);
 assert.throws(()=>planTitle('Anextremelylongword',box,metric));assert.throws(()=>planTitle('one two three four five six seven eight', {...box,width:250},metric));
 assert.throws(()=>planTitle('one two three',box,()=>({width:1})));
 assertMeasuredTitle(box,[{x:10,y:10,width:100,height:80}]);
 assert.throws(()=>assertMeasuredTitle(box,[{x:-1,y:10,width:100,height:80}]));
});
test('title cache tracks visible chunks and caption obstacle across boundary with distant reuse',()=>{
 const p=make();p.words[0].start=4.8;p.words[0].end=4.9;p.words[1].start=4.95;p.words[1].end=5.15;p.words[2].start=5.16;p.words[2].end=5.4;
 p.captions=[{wordIds:['w0','w1']},...p.words.slice(2).map(w=>({wordIds:[w.id]}))];p.title.from=90;p.title.frames=60;
 const key=(p,a,b)=>JSON.stringify(chunkContent(p,a,b)),a=key(p,0,149),b=key(p,150,299),far=key(p,300,449);
 for(const mutate of [q=>q.title.text+='!',q=>q.title.style='other',q=>q.title.from--,q=>q.title.bounds.x++]){
  const q=structuredClone(p);mutate(q);assert.notEqual(key(q,0,149),a);assert.equal(key(q,300,449),far);
 }
 const q=structuredClone(p);q.title.bounds.x++;assert.notEqual(key(q,150,299),b);
 assert.deepEqual(titleForCaption(p.title,[144,155]),p.title.bounds);assert.equal(titleForCaption(p.title,[150,160]),null);
 const absent=structuredClone(p);delete absent.title;assert.ok(!('title' in chunkContent(absent,0,149)));assert.ok(!('titleCaptionObstacles' in chunkContent(absent,0,149)));
});
