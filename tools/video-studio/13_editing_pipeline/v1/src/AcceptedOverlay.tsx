import React,{useEffect,useLayoutEffect,useRef,useState} from 'react';
import {cancelRender,continueRender,delayRender,staticFile} from 'remotion';
import {acceptedCaptionLayout,acceptedHeadlineLayout,groupAcceptedCaptions} from '../accepted-style.mjs';
import {checkContentBounds} from '../safe-zones.mjs';
import {fontCoversText} from '../font-coverage.mjs';

export function AcceptedOverlay({project,caption,title,cells,planOnly=false}:any){
 const [layout,setLayout]=useState<any>(),svg=useRef<SVGSVGElement>(null),[handle]=useState(()=>delayRender('Approved fonts and glyph ink'));
 const released=useRef(false),release=()=>{if(!released.current){released.current=true;continueRender(handle);}};
 useEffect(()=>{let active=true;
  (async()=>{
   const bytes=await Promise.all(['font.ttf','headline-font.ttf'].map(async name=>{const response=await fetch(staticFile(name));if(!response.ok)throw Error('Approved font is unavailable');return response.arrayBuffer();}));
   const captionText=planOnly?project.words.map((w:any)=>w.text).join(' '):caption?.wordIds.map((id:string)=>project.words.find((w:any)=>w.id===id).text).join(' ')||'';
   if(!fontCoversText(bytes[0],captionText)||!fontCoversText(bytes[1],title?.text||''))throw Error('The approved font does not contain a character. Edit the text and retry.');
   const faces=[new FontFace('EP Accepted Caption',bytes[0],{weight:'700'}),new FontFace('EP Accepted Headline',bytes[1],{weight:'700'})];
   await Promise.all(faces.map(async face=>{await face.load();document.fonts.add(face);}));
   if(!active)return;
   const context=document.createElement('canvas').getContext('2d');if(!context)throw Error('Actual font measurement is unavailable');
   const measure=(text:string,headline=false)=>{context.font=headline?'700 42px "EP Accepted Headline"':'700 34.666667px "EP Accepted Caption"';context.fontKerning='normal';const m=context.measureText(text);return{width:m.width,left:m.actualBoundingBoxLeft,right:m.actualBoundingBoxRight,ascent:m.actualBoundingBoxAscent,descent:m.actualBoundingBoxDescent,fontAscent:m.fontBoundingBoxAscent};};
   if(planOnly){let end=0;const groups=groupAcceptedCaptions(project.words,project.cuts.map((c:any)=>end+=c.out-c.in),(text:string)=>measure(text+'M').right-measure('M').right);console.log('EP_ACCEPTED_CAPTIONS:'+JSON.stringify(groups));release();return;}
   const result={caption:caption?acceptedCaptionLayout(caption.wordIds.map((id:string)=>project.words.find((w:any)=>w.id===id).text),measure):null,title:title?acceptedHeadlineLayout(title.text,(text:string)=>measure(text,true)):null};
   if(active)setLayout(result);
  })().catch(error=>{if(active)cancelRender(error);});return()=>{active=false;release();};
 },[]);
 useLayoutEffect(()=>{if(!layout||!svg.current)return;
  try{for(const node of Array.from(svg.current.querySelectorAll('text'))){const b=node.getBBox(),stroke=node.hasAttribute('data-caption-ink')?1.2:0;
   const polygon=[[b.x-stroke,b.y-stroke],[b.x+b.width+stroke,b.y-stroke],[b.x+b.width+stroke,b.y+b.height+stroke],[b.x-stroke,b.y+b.height+stroke]].map(([x,y])=>[x/720,y/1280]);
   if(!checkContentBounds(polygon,cells).valid)throw Error('Approved text conflicts with a selected platform. Change the destination or text and retry.');
  }release();}catch(error){cancelRender(error);}
 },[layout]);
 if(!layout)return null;
 return <svg ref={svg} viewBox="0 0 720 1280" width="1080" height="1920" style={{position:'absolute',inset:0,overflow:'visible'}}>
  {layout.title&&<g data-title="measured"><rect {...layout.title.box} rx={12} fill="#fff"/><text x={layout.title.x} y={layout.title.y} fontFamily="EP Accepted Headline" fontWeight={700} fontSize={42} fill="#101010" xmlSpace="preserve">{title.text}</text></g>}
  {layout.caption&&<g data-caption={caption.wordIds.join(',')} data-safe-caption="measured">{layout.caption.pieces.map((p:any,i:number)=><text key={i} data-caption-ink="true" x={p.x} y={p.y} fontFamily="EP Accepted Caption" fontWeight={700} fontSize={34.666667} fill="#fff" stroke="rgba(8,8,8,0.9411764705882353)" strokeWidth={2.4} strokeLinejoin="round" paintOrder="stroke fill" xmlSpace="preserve">{p.text}</text>)}</g>}
 </svg>;
}
