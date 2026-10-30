import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {fixture} from './fixture.mjs';
import {captionFrameRange,chunkContent,validateProject} from '../project.mjs';

test('regrouping across the 5s boundary invalidates both chunks but preserves distant cache keys',()=>{
  const p=fixture();
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
test('existing first-active selection can hide brief groups under the unchanged 120ms tail',()=>{
  const words=[{id:'a',text:'Yes.',start:0,end:.24},{id:'b',text:'Go!',start:.21,end:.22},
    {id:'c',text:'Now',start:.23,end:.7}],map=new Map(words.map(w=>[w.id,w]));
  const groups=words.map(w=>({wordIds:[w.id]}));
  const ranges=groups.map(c=>captionFrameRange(c,map,30,.7));
  const visible=Array.from({length:21},(_,frame)=>groups.findIndex((_,i)=>frame>=ranges[i][0]&&frame<ranges[i][1]));
  assert.ok(visible.includes(0));assert.equal(visible.includes(1),false);assert.ok(visible.includes(2));
  assert.deepEqual(groups.flatMap(c=>c.wordIds),['a','b','c']); // Membership is preserved; visibility is not promised.
});
