import test from 'node:test';
import assert from 'node:assert/strict';
import {ACCEPTED_STYLE,ACCEPTED_FONTS,roundCaptionFrame,acceptedCaptionRanges,groupAcceptedCaptions,acceptedCaptionLayout,acceptedHeadlineLayout} from '../accepted-style.mjs';
import {validateProject,chunkContent} from '../project.mjs';
import {layoutInputHash,preflightFrames} from '../title-preflight.mjs';
import {fixture} from './fixture.mjs';
import {readFileSync} from 'node:fs';
import {fontCoversText} from '../font-coverage.mjs';

test('accepted endpoint rounding uses decimal half-up including exponent notation',()=>{
 assert.deepEqual([.15,.35,.55,.75,1.15,1e-7].map(roundCaptionFrame),[5,11,17,23,35,0]);
 assert.throws(()=>roundCaptionFrame(NaN));assert.throws(()=>roundCaptionFrame(-1));
});
test('accepted groups preserve IDs and split at width, count, punctuation, gaps and seams',()=>{
 const words=['one','two,','three','four','five','six','seven'].map((text,i)=>({id:'source-'+i,text,start:i*.1,end:i*.1+.08}));
 const measure=text=>text.length*10;
 assert.deepEqual(groupAcceptedCaptions(words,[180],measure),[{wordIds:['source-0','source-1']},{wordIds:['source-2','source-3','source-4']},{wordIds:['source-5','source-6']}]);
 const pair=[{id:'a',text:'same',start:.1,end:.2},{id:'b',text:'same',start:.39,end:.5}];
 assert.equal(groupAcceptedCaptions(pair,[180],measure).length,1);
 assert.equal(groupAcceptedCaptions([{id:'a',text:'same',start:.5,end:.6},{id:'b',text:'same',start:.79,end:.9}],[180],measure).length,1);
 pair[1].start=.391;assert.equal(groupAcceptedCaptions(pair,[180],measure).length,2);
 pair[1].start=.4;assert.equal(groupAcceptedCaptions(pair,[12,180],measure).length,2);
 assert.equal(groupAcceptedCaptions(words,[180],text=>text.length*60).every(g=>g.wordIds.length===1),true);
 assert.throws(()=>groupAcceptedCaptions([{id:'long',text:'Unfittable',start:0,end:1}],[60],()=>361),/exceeds/);
});
test('accepted display tails stop at next phrase or output end without karaoke states',()=>{
 const p={cuts:[{in:0,out:60}],words:[{id:'a',start:.15,end:.35},{id:'b',start:.45,end:.6}],captions:[{wordIds:['a']},{wordIds:['b']}]};
 assert.deepEqual(acceptedCaptionRanges(p),[[5,14],[14,23]]);
 const decimalTail={cuts:p.cuts,words:[{id:'x',start:.2,end:.47}],captions:[{wordIds:['x']}]};
 assert.deepEqual(acceptedCaptionRanges(decimalTail),[[6,20]]);
 Object.assign(decimalTail.words[0],{start:.3-.1,end:.57-.1,sourceStart:.3,sourceEnd:.57,frameOffset:-3,sourceSpan:0});
 assert.deepEqual(acceptedCaptionRanges(decimalTail),[[6,20]]);
 p.words[1].end=2;assert.deepEqual(acceptedCaptionRanges(p)[1],[14,60]);
});
test('headline uses ink centered at 360/228 and rejects overflow instead of fitting by shrink',()=>{
 const bytes=readFileSync(new URL('../fonts/TikTokSans36pt-Bold.ttf',import.meta.url));
 const buffer=bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);
 assert.equal(fontCoversText(buffer,'Approved headline.'),true);assert.equal(fontCoversText(buffer,'你好'),false);
 const measure=()=>({left:2,right:198,ascent:32,descent:8}),p=acceptedHeadlineLayout('Example',measure);
 assert.deepEqual(p,{x:262,y:240,box:{x:248,y:200,width:224,height:56}});
 assert.throws(()=>acceptedHeadlineLayout('Too wide',()=>({...measure(),right:359})),/too wide/);
 assert.throws(()=>acceptedHeadlineLayout('Too tall',()=>({...measure(),ascent:85})),/does not fit/);
});
test('caption outline origins use actual ascent, separate trailing-space pieces and ink centering',()=>{
 const measure=text=>({left:1,right:text.trimEnd().length*12,ascent:26,descent:7,fontAscent:32});
 const p=acceptedCaptionLayout(['Keep','this.'],measure),ink=p.pieces.map(w=>w.ink);
 assert.equal(p.pieces[0].text,'Keep ');assert.equal(p.pieces[1].text,'this.');
 assert.ok(Math.abs(p.pieces[0].y-809.333333)<1e-6);
 assert.equal((Math.min(...ink.map(b=>b.x))+Math.max(...ink.map(b=>b.x+b.width)))/2,360);
 assert.throws(()=>acceptedCaptionLayout(['A'.repeat(40)],measure),/does not fit/);
});
test('approved style admits source cuts while legacy V2 still rejects them; style and tail affect caches',()=>{
 const p=fixture();Object.assign(p,{schemaVersion:2,profile:'talking-head-v2',editorStyle:ACCEPTED_STYLE,canvas:{width:1080,height:1920,fps:30},assets:p.assets.slice(0,1),broll:[],effects:[],safeZones:{version:1,profiles:['instagram-approved-editor-v1']}});
 p.title={version:1,style:ACCEPTED_STYLE,text:'Example',wordIds:[],from:0,frames:135,bounds:{x:108,y:276,width:720,height:132}};
 p.source.frames=180;p.source.audioSampleFrames=180*1600;p.audioSampleFrames=150*1600;p.assets[0].width=360;p.assets[0].height=640;p.assets[0].duration=6;p.cuts=[{in:0,out:60,reason:'First'},{in:90,out:180,reason:'Second'}];
 p.words=[{id:'w0',text:'One',start:.1,end:.3,sourceStart:.1,sourceEnd:.3,frameOffset:0,sourceSpan:0},{id:'w1',text:'Two',start:2.5,end:2.7,sourceStart:3.5,sourceEnd:3.7,frameOffset:-30,sourceSpan:1}];p.captions=p.words.map(w=>({wordIds:[w.id]}));
 p.speaker.faces=p.speaker.faces.slice(0,1);p.speaker.faces[0].t=1;validateProject(p);
 const key=JSON.stringify(chunkContent(p,0,149));delete p.editorStyle;assert.throws(()=>validateProject(p),/tracks or source/);
 p.editorStyle=ACCEPTED_STYLE;assert.equal(JSON.stringify(chunkContent(p,0,149)),key);
 const before=layoutInputHash(p);p.source.originalFrames=p.source.frames-1;assert.notEqual(layoutInputHash(p),before);
 const mapped=layoutInputHash(p);p.words[1].sourceEnd=3.700000000001;assert.notEqual(layoutInputHash(p),mapped);p.words[1].sourceEnd=3.7;
 delete p.source.originalFrames;p.source.frames=1800;p.source.audioSampleFrames=p.audioSampleFrames=1800*1600;p.assets[0].duration=60;p.cuts=[{in:0,out:1800,reason:'Full source'}];
 p.words=Array.from({length:140},(_,i)=>({id:'w'+i,text:'Word',start:.1+i*.4,end:.2+i*.4,sourceStart:.1+i*.4,sourceEnd:.2+i*.4,frameOffset:0,sourceSpan:0}));p.captions=p.words.map(w=>({wordIds:[w.id]}));assert.ok(preflightFrames(p).length>=140);
 p.editorStyle='unrecognized';assert.throws(()=>validateProject(p),/style/);
});
test('exact approved fonts plan and verify browser layout; overflow and fallback fail closed',{skip:!process.env.EP_PREFLIGHT_TEST_RUNTIME,timeout:180000},async t=>{
 const {mkdtemp,mkdir,readFile,writeFile,copyFile,access,rm}=await import('node:fs/promises');
 const {default:path}=await import('node:path'),{default:os}=await import('node:os');
 const {execFile}=await import('node:child_process'),{promisify}=await import('node:util');
 const root=new URL('..',import.meta.url),dir=await mkdtemp(path.join(os.tmpdir(),'ep-accepted-layout-')),runtime=process.env.EP_PREFLIGHT_TEST_RUNTIME,run=promisify(execFile);
 t.after(()=>rm(dir,{recursive:true,force:true}));
 const p=fixture();Object.assign(p,{schemaVersion:2,profile:'talking-head-v2',editorStyle:ACCEPTED_STYLE,canvas:{width:1080,height:1920,fps:30},assets:p.assets.slice(0,1),broll:[],effects:[],safeZones:{version:1,profiles:['instagram-approved-editor-v1']}});
 p.title={version:1,style:ACCEPTED_STYLE,text:'My voice.',wordIds:[],from:0,frames:135,bounds:{x:108,y:276,width:720,height:132}};
 p.source.frames=180;p.source.audioSampleFrames=180*1600;p.audioSampleFrames=150*1600;p.assets[0].width=360;p.assets[0].height=640;p.assets[0].duration=6;p.cuts=[{in:0,out:60,reason:'First'},{in:90,out:180,reason:'Second'}];
 p.words=['Keep','my','voice.','This','fits.'].map((text,i)=>{const start=i<3?.1+i*.2:2.5+(i-3)*.2,offset=i<3?0:-30;return{id:'w'+i,text,start,end:start+.15,sourceStart:start-offset/30,sourceEnd:start+.15-offset/30,frameOffset:offset,sourceSpan:i<3?0:1};});
 p.captions=p.words.map(w=>({wordIds:[w.id]}));p.speaker.faces=p.speaker.faces.slice(0,1);p.speaker.faces[0].t=1;validateProject(p);
 async function candidate(name,project){const d=path.join(dir,name);await mkdir(path.join(d,'public'),{recursive:true});await writeFile(path.join(d,'project.json'),JSON.stringify(project));for(const [kind,name]of [['caption','font.ttf'],['headline','headline-font.ttf']])await copyFile(new URL('../fonts/'+ACCEPTED_FONTS[kind].file,import.meta.url),path.join(d,'public',name));return d;}
 const command=(name,d)=>run(process.execPath,['run.mjs',name,d,'--runtime',runtime],{cwd:root,timeout:150000,maxBuffer:2*1024*1024});
 const d=await candidate('valid',p),planned=await command('accepted-captions',d);assert.doesNotThrow(()=>JSON.parse(planned.stdout),planned.stdout);const groups=JSON.parse(planned.stdout);
 assert.deepEqual(groups,[{wordIds:['w0','w1','w2']},{wordIds:['w3','w4']}]);p.captions=groups;await writeFile(path.join(d,'project.json'),JSON.stringify(p));
 await command('title-preflight',d);await command('title-preflight-check',d);
 const receipt=JSON.parse(await readFile(path.join(d,'title-preflight.json'),'utf8'));assert.equal(receipt.fontSha256,ACCEPTED_FONTS.caption.sha256);assert.equal(receipt.headlineFontSha256,ACCEPTED_FONTS.headline.sha256);assert.deepEqual(receipt.expectedCheckedFrames,preflightFrames(p));
 const wide=structuredClone(p);wide.title.text='W'.repeat(25);const bad=await candidate('wide-headline',wide);await assert.rejects(command('title-preflight',bad));await assert.rejects(access(path.join(bad,'title-preflight.json')));
 const word=structuredClone(p);word.words[0].text='W'.repeat(45);await assert.rejects(command('accepted-captions',await candidate('wide-word',word)));
 await copyFile(new URL('../fonts/TikTokSans36pt-Bold.ttf',import.meta.url),path.join(d,'public/font.ttf'));await assert.rejects(command('accepted-captions',d),/font mismatch/i);
});
