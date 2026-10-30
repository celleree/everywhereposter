import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {fixture} from './fixture.mjs';
import {captionFrameRange,captionFrameRanges,chunkContent,validateProject} from '../project.mjs';

test('regrouping across the 5s boundary invalidates both chunks but preserves distant cache keys',()=>{
  const p=fixture();p.captionTimingPolicy='trim-trailing-hold-v1';
  p.words=[{id:'w0',text:'First.',start:4.8,end:4.9},{id:'w1',text:'Next',start:5.05,end:5.2},
    {id:'w2',text:'Distant',start:70,end:70.3}];
  p.effects=[];p.broll=[];
  p.captions=[{wordIds:['w0','w1']},{wordIds:['w2']}];validateProject(p);
  const key=(first,last)=>createHash('sha256').update(JSON.stringify(chunkContent(p,first,last))).digest('hex');
  const ranges=[[0,149],[150,299],[2100,2249]],before=ranges.map(r=>key(...r));
  p.captions=[{wordIds:['w0']},{wordIds:['w1']},{wordIds:['w2']}];validateProject(p);
  const after=ranges.map(r=>key(...r));
  assert.notEqual(before[0],after[0]);assert.notEqual(before[1],after[1]);assert.equal(before[2],after[2]);
  const affected=chunkContent(p,150,299).captions;
  assert.deepEqual(affected.map(c=>c.wordIds),[['w0'],['w1']]); // 120ms tail still intersects.
  assert.equal(affected[1].words[0].start,5.05);
});
test('same-span merges and opt-in timing restore brief words while legacy replay stays unchanged',()=>{
  const words=[{id:'a',text:'Yes.',start:0,end:.24},{id:'b',text:'Go!',start:.21,end:.22},
    {id:'c',text:'Now',start:.23,end:.7}],map=new Map(words.map(w=>[w.id,w]));
  const groups=words.map(w=>({wordIds:[w.id]}));
  const ranges=groups.map(c=>captionFrameRange(c,map,30,.7));
  const visible=Array.from({length:21},(_,frame)=>groups.findIndex((_,i)=>frame>=ranges[i][0]&&frame<ranges[i][1]));
  assert.ok(visible.includes(0));assert.equal(visible.includes(1),false);assert.ok(visible.includes(2));
  const repaired=[{wordIds:['a','b']},{wordIds:['c']}];
  const shown=new Set();
  for(let frame=0;frame<21;frame++){
    const active=repaired.find(c=>{const [from,end]=captionFrameRange(c,map,30,.7);return frame>=from&&frame<end;});
    active?.wordIds.forEach(id=>shown.add(id));
  }
  assert.deepEqual([...shown],['a','b','c']);
  // Legacy timing hides a final brief word at a seam. The opt-in policy
  // trims only the previous hold, preserving distinct group membership.
  const seamWords=[{id:'left',text:'Before',start:.1,end:1},{id:'right',text:'Go!',start:1,end:1.01}];
  const seamMap=new Map(seamWords.map(w=>[w.id,w])),separate=seamWords.map(w=>({wordIds:[w.id]}));
  const activeIds=new Set();
  for(let frame=0;frame<31;frame++){
    separate.find(c=>{const [from,end]=captionFrameRange(c,seamMap,30,1.01);return frame>=from&&frame<end;})?.wordIds.forEach(id=>activeIds.add(id));
  }
  assert.deepEqual([...activeIds],['left']);
  assert.deepEqual(captionFrameRange({wordIds:['left','right']},seamMap,30,1.01),[3,31]);
  const timingProject={canvas:{fps:30},words:seamWords,captions:separate};
  assert.deepEqual(captionFrameRanges(timingProject),[[3,31],[30,31]]);
  timingProject.captionTimingPolicy='trim-trailing-hold-v1';
  const optedRanges=captionFrameRanges(timingProject),optedIn=new Set();
  assert.deepEqual(optedRanges,[[3,30],[30,31]]);
  for(let frame=0;frame<31;frame++){
    separate.find((_,i)=>frame>=optedRanges[i][0]&&frame<optedRanges[i][1])?.wordIds.forEach(id=>optedIn.add(id));
  }
  assert.deepEqual([...optedIn],['left','right']);
  assert.deepEqual(separate.flatMap(c=>c.wordIds),seamWords.map(w=>w.id));
});
