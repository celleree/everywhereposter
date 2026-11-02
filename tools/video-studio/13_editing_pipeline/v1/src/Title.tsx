import React,{useEffect,useLayoutEffect,useRef,useState} from 'react';
import {cancelRender,continueRender,delayRender} from 'remotion';
import {TITLE_STYLE,planTitle,assertMeasuredTitle} from '../title-layout.mjs';

export function Title({title}:any){
 const [layout,setLayout]=useState<any>(null),svg=useRef<SVGSVGElement>(null);
 const [handle]=useState(()=>delayRender('Measure title layout')),released=useRef(false);
 const release=()=>{if(!released.current){released.current=true;continueRender(handle);}};
 useEffect(()=>{
  let active=true;
  document.fonts.load(TITLE_STYLE.font,title.text).then(fonts=>{
   if(!active)return;
   if(!fonts.length)throw Error('Missing bound title font');
   const context=document.createElement('canvas').getContext('2d');
   if(!context)throw Error('Title font measurement unavailable');
   context.font=TITLE_STYLE.font;context.fontKerning='normal';
   setLayout(planTitle(title.text,title.bounds,(text:string)=>{const m=context.measureText(text);return {width:m.width,left:m.actualBoundingBoxLeft,right:m.actualBoundingBoxRight,ascent:m.actualBoundingBoxAscent,descent:m.actualBoundingBoxDescent};}));
  }).catch(error=>{if(active)cancelRender(error);});
  return()=>{active=false;release();};
 },[]);
 useLayoutEffect(()=>{
  if(!layout||!svg.current)return;
  try{assertMeasuredTitle(layout.box,Array.from(svg.current.querySelectorAll('text')).map(node=>{const b=node.getBBox();return{x:b.x,y:b.y,width:b.width,height:b.height};}));release();}
  catch(error){cancelRender(error);}
 },[layout]);
 if(!layout)return null;
 const b=layout.box;
 return <div data-title="measured" style={{position:'absolute',left:b.x,top:b.y,width:b.width,height:b.height,background:'#101714'}}>
  <svg ref={svg} width={b.width} height={b.height} style={{overflow:'visible'}}>
   {layout.lines.map((line:any,i:number)=><text key={i} x={line.x} y={line.baseline} fontFamily="EP Plex" fontWeight={700} fontSize={96} style={{fontKerning:'normal'}} fill="#fff" xmlSpace="preserve">{line.text}</text>)}
  </svg>
 </div>;
}
