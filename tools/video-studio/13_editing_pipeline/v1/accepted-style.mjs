// Frozen user-selected design, expressed at the 720x1280 reference size.
import {decimal,add,subtract,compare,mappedTime,frame} from './decimal-clock.mjs';
export const ACCEPTED_STYLE='accepted-caption-b-top-rounded-v1';
export const ACCEPTED_FONTS=Object.freeze({caption:{file:'LiberationSans-Bold.ttf',sha256:'3973aa5054fb467dd5627245d3dc82e37bf16fe075756156a570455871351582'},headline:{file:'TikTokSans36pt-Bold.ttf',sha256:'f6da258a8664b99d1a5a071cc7aebedd06e4acae6e97b8f18df7af640089636f'}});
export const ACCEPTED_EDITOR_CAPABILITY=Object.freeze({version:1,style:ACCEPTED_STYLE,profile:'talking-head-v2',captionPlanCommand:'accepted-captions',fonts:ACCEPTED_FONTS});
export function roundCaptionFrame(seconds){
 if(!Number.isFinite(seconds)||seconds<0)throw Error('Invalid caption endpoint');
 return frame(decimal(seconds));
}
export function acceptedCaptionRanges(p){
 const words=new Map(p.words.map(w=>[w.id,w])),duration={n:BigInt(p.cuts.reduce((n,c)=>n+c.out-c.in,0)),d:30n};
 return p.captions.map((c,i)=>{
  const ends=[add(mappedTime(words.get(c.wordIds.at(-1)),true),decimal(.18)),duration];
  if(i+1<p.captions.length)ends.push(mappedTime(words.get(p.captions[i+1].wordIds[0])));
  return [frame(mappedTime(words.get(c.wordIds[0]))),frame(ends.reduce((a,b)=>compare(a,b)<0n?a:b))];
 });
}
export function groupAcceptedCaptions(words,keptFrameEnds,measure){
 const groups=[];let current=[],span=-1;
 const flush=()=>{if(current.length)groups.push({wordIds:current.map(w=>w.id)});current=[];};
 for(const word of words){
  const width=measure(word.text),nextSpan=word.sourceSpan??keptFrameEnds.findIndex(end=>compare(mappedTime(word),{n:BigInt(end),d:30n})<0n);
  if(!Number.isFinite(width)||width<=0||width>360)throw Error('Caption word exceeds the approved width. Edit the transcript and retry.');
  if(current.length&&(current.length===3||nextSpan!==span||compare(subtract(mappedTime(word),mappedTime(current.at(-1),true)),decimal(.19))>0n||measure([...current,word].map(w=>w.text).join(' '))>360))flush();
  span=nextSpan;current.push(word);if(/[.,!?]$/.test(word.text))flush();
 }
 flush();return groups;
}
// CSS/SVG baselines differ from GDI outline origins. Convert the reference em
// origin using the bound font's measured ascent, then center actual union ink.
export function acceptedCaptionLayout(texts,measure){
 let x=0;const pieces=texts.map((text,i)=>{const value=text+(i<texts.length-1?' ':''),m=measure(value),base=measure('M'),withM=measure(value+'M');
  if(!['left','right','ascent','descent','fontAscent'].every(k=>Number.isFinite(m[k])))throw Error('Caption requires actual bound font metrics');
  const piece={text:value,x,y:777.333333+m.fontAscent,ink:{x:x-m.left,y:777.333333+m.fontAscent-m.ascent,width:m.left+m.right,height:m.ascent+m.descent}};
  x+=withM.right-base.right;return piece;});
 const left=Math.min(...pieces.map(p=>p.ink.x)),right=Math.max(...pieces.map(p=>p.ink.x+p.ink.width)),dx=360-(left+right)/2;
 const guard={x:left+dx-10.666667,y:772,width:right-left+21.333334,height:34.666667*1.12+12};
 if(!pieces.length||guard.x<72-1e-5||guard.x+guard.width>552+1e-5||guard.y+guard.height>832)throw Error('Caption does not fit the approved layout. Edit the transcript and retry.');
 return {pieces:pieces.map(p=>({...p,x:p.x+dx,ink:{...p.ink,x:p.ink.x+dx}})),guard};
}
export function acceptedHeadlineLayout(text,measure){
 const m=measure(text),width=m.left+m.right,height=m.ascent+m.descent;
 if(!Number.isFinite(width)||width<=0||height<=0||width>360)throw Error('Headline is too wide. Use a shorter headline and retry.');
 const x=360-(m.right-m.left)/2,y=228+(m.ascent-m.descent)/2;
 const box={x:360-width/2-12,y:228-height/2-8,width:width+24,height:height+16};
 if(box.x<72||box.y<184||box.x+box.width>552||box.y+box.height>272)throw Error('Headline does not fit the approved box. Edit it and retry.');
 return {x,y,box};
}
