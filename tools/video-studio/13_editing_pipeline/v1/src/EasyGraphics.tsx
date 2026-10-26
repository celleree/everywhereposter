import React,{useEffect,useLayoutEffect,useRef,useState} from 'react';
import {Img,staticFile,useCurrentFrame,useVideoConfig,delayRender,continueRender,cancelRender} from 'remotion';
import {easyLayout,fitLines,assertEffectInk} from '../effect-content-bounds.mjs';
// Adapted from Easy HeaderArt.tsx sha256 9f1d8cb1de774e54483d7dc7008e92318ab8725474d4abad92b4d6983305fdce
// and sample Integration/InputOutput sha256 8b627b0a0083fd331cd9befd848a238331d4646285d19178b8029f9477cb4865.
// These adapters are distinct from the unavailable private effects.
export function EasyGraphics({event:e,assets,cells}:any){
 const frame=useCurrentFrame(),{fps}=useVideoConfig(),svg=useRef<SVGSVGElement>(null);
 const [handle]=useState(()=>delayRender('Measure accessible effect')),done=useRef(false),[lines,setLines]=useState<any>(null);
 const release=()=>{if(!done.current){done.current=true;continueRender(handle)}};
 const layout=easyLayout(e),ink=e.props.theme==='dark'?'#172021':'#fff',accent=e.props.theme==='dark'?'#267b85':'#72d1d8';
 useEffect(()=>{let active=true;document.fonts.load('700 38px "EP Plex"').then(fonts=>{
  if(!active)return;if(!fonts.length)throw Error('Missing effect font');const c=document.createElement('canvas').getContext('2d');if(!c)throw Error('Missing text measurement');
  const measure=(s:string,size:number)=>{c.font=`700 ${size}px "EP Plex"`;return c.measureText(s).width};
  if(layout.heading&&measure(layout.heading.text,32)>layout.heading.maxWidth)throw Error('Effect heading does not fit');
  const fitted=layout.items.map((n:any)=>n.label?fitLines(n.label,n.width-32,measure,38):[]);
  if(e.type==='EasyMediaPanels'&&layout.items.some((n:any,i:number)=>n.height-24-fitted[i].length*44<60))throw Error('Panel image is too small at readable label size');
  setLines(fitted);
 }).catch(cancelRender);return()=>{active=false;release()};},[]);
 useLayoutEffect(()=>{if(!lines||!svg.current)return;try{const boxes=Array.from(svg.current.querySelectorAll('[data-critical]')).map(node=>{const el=node as SVGGraphicsElement,b=el.getBBox(),m=svg.current!.getScreenCTM()!.inverse().multiply(el.getScreenCTM()!);const pts=[[b.x,b.y],[b.x+b.width,b.y],[b.x+b.width,b.y+b.height],[b.x,b.y+b.height]].map(([x,y])=>new DOMPoint(x,y).matrixTransform(m));return{x:Math.min(...pts.map(p=>p.x)),y:Math.min(...pts.map(p=>p.y)),width:Math.max(...pts.map(p=>p.x))-Math.min(...pts.map(p=>p.x)),height:Math.max(...pts.map(p=>p.y))-Math.min(...pts.map(p=>p.y))}});assertEffectInk(e,boxes,cells);release()}catch(error){cancelRender(error)}},[lines]);
 if(!lines)return null;
 const opacity=(at:number)=>Math.max(0,Math.min(1,(frame/fps-at)/.2));
 return <svg ref={svg} width={e.bounds.width} height={e.bounds.height} style={{position:'absolute',left:e.bounds.x,top:e.bounds.y,overflow:'visible',fontFamily:'EP Plex',fontWeight:700}}>
  {layout.heading?<text data-critical x={e.bounds.width/2} y={34} textAnchor="middle" fill={ink} fontSize={32}>{layout.heading.text}</text>:null}
  {layout.connectors.map((c:any,i:number)=><path key={i} data-critical d={c.d} fill="none" stroke={accent} strokeWidth={4} opacity={opacity((i+1)*.25)}/>)}
  {layout.items.map((n:any,i:number)=>{const x=n.x-e.bounds.x,y=n.y-e.bounds.y,label=lines[i],panel=e.type==='EasyMediaPanels',labelHeight=label.length*44;return <g key={n.id}>
   <rect data-critical x={x+4} y={y+4} width={n.width-8} height={n.height-8} rx={12} fill={e.props.theme==='dark'?'#fffdf8':'#172021'} stroke={ink} strokeWidth={2} opacity={opacity(n.at)}/>
   {panel?<foreignObject x={x+12} y={y+12} width={n.width-24} height={n.height-24-labelHeight} opacity={opacity(n.at)}><Img src={staticFile(assets.get(n.assetId).file)} style={{width:'100%',height:'100%',objectFit:'contain'}}/></foreignObject>:null}
   {!panel&&n.icon?<g data-critical transform={`translate(${x+n.width/2-18} ${y+18})`} fill="none" stroke={accent} strokeWidth={4} opacity={opacity(n.at)}>{n.icon==='recording'?<><rect width={36} height={40} rx={4}/><path d="M12 10 L27 20 L12 30 Z"/></>:n.icon==='conversation'?<path d="M0 0 H36 V28 H12 L0 40 Z"/>:n.icon==='product'?<><rect width={36} height={36}/><path d="M8 10 H28 M8 20 H22"/></>:<><rect width={36} height={40}/><path d="M8 10 H28 M8 20 H28 M8 30 H20"/></>}</g>:null}
   {label.map((text:string,j:number)=><text key={j} data-critical x={x+n.width/2} y={panel?y+n.height-labelHeight+34+j*44:y+n.height/2+(n.icon?26:0)-(label.length-1)*22+j*44+12} fontSize={38} textAnchor="middle" fill={ink} opacity={opacity(n.at)}>{text}</text>)}
  </g>})}
 </svg>;
}
