import {EasyGraphics} from './EasyGraphics';
import React,{useEffect,useLayoutEffect,useMemo,useRef,useState} from 'react';
import {AbsoluteFill,Audio,Img,OffthreadVideo,Sequence,cancelRender,continueRender,delayRender,getRemotionEnvironment,staticFile,useCurrentFrame,useVideoConfig} from 'remotion';
import {validateProject,captionFrameRange} from '../project.mjs';
import {assertMeasuredCaption,assertSafeZoneRender,CAPTION_STYLE,planCaption} from '../safe-zones.mjs';
export function Font(){const[h]=useState(()=>delayRender('Local editorial font'));useEffect(()=>{document.fonts.load('700 72px "EP Plex"').then(f=>{if(!f.length)throw Error('Missing local font');continueRender(h);}).catch(cancelRender);},[h]);return <style>{`@font-face{font-family:'EP Plex';src:url('${staticFile('font.ttf')}');font-weight:700;font-display:block}`}</style>;}
const media=(a:any,preview:boolean)=>staticFile(preview&&a.previewFile?a.previewFile:a.file);
// Shared by Player and export. Captions are static within each original word group:
// one measured layout therefore covers every output frame, without changing timing.
function SafeCaption({wordTexts,cells,avoid,wordIds,background}:any){
 const [layout,setLayout]=useState<any>(null),svg=useRef<SVGSVGElement>(null);
 const [handle]=useState(()=>delayRender('Measure caption safe-zone layout'));
 const released=useRef(false);
 const release=()=>{if(!released.current){released.current=true;continueRender(handle);}};
 useEffect(()=>{
  let active=true;
  document.fonts.load(CAPTION_STYLE.font,wordTexts.join(' ')).then(fonts=>{
   if(!active)return;
   if(!fonts.length)throw Error('Missing bound caption font');
   const context=document.createElement('canvas').getContext('2d');
   if(!context)throw Error('Caption font measurement unavailable');
   context.font=CAPTION_STYLE.font;context.fontKerning='normal';
   const measure=(text:string)=>{const m=context.measureText(text);return{width:m.width,left:m.actualBoundingBoxLeft,right:m.actualBoundingBoxRight,ascent:m.actualBoundingBoxAscent,descent:m.actualBoundingBoxDescent};};
   setLayout(planCaption(wordTexts,cells,measure,avoid));
  }).catch(error=>{if(active)cancelRender(error);});
  return()=>{active=false;release();};
 },[]);
 useLayoutEffect(()=>{
  if(!layout||!svg.current)return;
  try{
   const glyphs=Array.from(svg.current.querySelectorAll('text')).map(node=>{const b=node.getBBox();return{x:b.x,y:b.y,width:b.width,height:b.height};});
   assertMeasuredCaption(layout.box,glyphs,cells,layout.stroke);
   release();
  }catch(error){cancelRender(error);}
 },[layout]);
 if(!layout)return null;
 return <div data-caption={wordIds.join(',')} data-safe-caption="measured" style={{position:'absolute',left:layout.box.x,top:layout.box.y,width:layout.box.width,height:layout.box.height,borderRadius:20,background}}>
  <svg ref={svg} width={layout.box.width} height={layout.box.height} style={{overflow:'visible'}}>
   {layout.lines.map((line:any,i:number)=><text key={i} x={line.x} y={line.baseline} fontFamily="EP Plex" fontWeight={700} fontSize={layout.fontSize} style={{fontKerning:'normal'}} fill="#fff" stroke="#000" strokeWidth={layout.stroke} paintOrder="stroke fill" xmlSpace="preserve">{line.text}</text>)}
  </svg>
 </div>;
}
function Effect({event,assets,cells}:any){return <EasyGraphics event={event} assets={assets} cells={cells}/>;}
export const Film:React.FC<{project:any;preview?:boolean;hideGraphics?:boolean}>=({project:p,preview=false,hideGraphics=false})=>{
 const{assets,words,safeZones}=useMemo(()=>validateProject(p),[p]),frame=useCurrentFrame(),{fps,width,height}=useVideoConfig();
 if(p.profile!=='easy-graphics-v1')throw Error('This package renders only easy-graphics-v1; historical effects require their original runtime');
 const rendering=getRemotionEnvironment().isRendering,isPreview=preview&&!rendering,source=assets.get(p.source.assetId);let cursor=0;
 if(rendering&&!hideGraphics)assertSafeZoneRender(safeZones);
 const caption=p.captions.find((c:any)=>{const [from,end]=captionFrameRange(c,words,fps,p.words.at(-1).end);return frame>=from&&frame<end;});
 const broll=p.broll.find((b:any)=>frame>=b.from&&frame<b.from+b.frames);
 const wordTexts=caption?.wordIds.map((id:string)=>words.get(id).text);
 const faceAvoid=caption&&!broll?p.speaker.faces.filter((f:any)=>f.t>=words.get(caption.wordIds[0]).start-.5&&f.t<=words.get(caption.wordIds.at(-1)).end+.5).map((f:any)=>({x:f.x-20,y:f.y-20,width:f.width+40,height:f.height+40})):[];
 const avoid=[...faceAvoid,...p.effects.filter((e:any)=>frame>=e.from&&frame<e.from+e.frames).map((e:any)=>e.bounds)];
 const aware=safeZones.status!=='UNASSESSED';
 if(!aware)throw Error('Accessible profile requires selected safe-zone targets');
 return <AbsoluteFill style={{background:'#101714',fontFamily:'EP Plex',fontWeight:700,color:'#fff'}}><Font/>
  {p.cuts.map((c:any,i:number)=>{const from=cursor;cursor+=c.out-c.in;return <Sequence key={i} from={from} durationInFrames={c.out-c.in}><OffthreadVideo muted src={media(source,isPreview)} startFrom={c.in} endAt={c.out} style={{width:'100%',height:'100%',objectFit:'cover'}}/></Sequence>;})}
  {!hideGraphics&&p.broll.map((b:any)=>{const a=assets.get(b.assetId);return <Sequence key={b.id} from={b.from} durationInFrames={b.frames}>{a.kind==='video'?<OffthreadVideo muted src={media(a,isPreview)} startFrom={Math.round(b.sourceStart*fps)} style={{width:'100%',height:'100%',objectFit:'cover'}}/>:<Img src={media(a,isPreview)} style={{width:'100%',height:'100%',objectFit:'cover'}}/>}</Sequence>;})}
  <Audio src={staticFile('speech.wav')}/>
  {!hideGraphics&&<div style={{position:'absolute',width:1080,height:1920,transform:`scale(${width/1080},${height/1920})`,transformOrigin:'0 0'}}>
   {p.effects.map((e:any)=><Sequence key={e.id} from={e.from} durationInFrames={e.frames}><Effect key={JSON.stringify([e,safeZones.cells])} event={e} assets={assets} cells={safeZones.cells}/></Sequence>)}
   {caption&&(aware?<SafeCaption key={JSON.stringify([caption.wordIds,wordTexts,safeZones.profiles.map((x:any)=>x.id),avoid])} wordTexts={wordTexts} wordIds={caption.wordIds} cells={safeZones.cells} avoid={avoid} background={broll?'#06131095':'linear-gradient(90deg,transparent,#06131065,transparent)'}/>:<div data-caption={caption.wordIds.join(',')} style={{position:'absolute',left:80,top:1500,width:920,minHeight:180,display:'flex',alignItems:'center',justifyContent:'center',textAlign:'center',fontSize:76,lineHeight:1.12,letterSpacing:'-.025em',textShadow:'0 3px 12px #000,0 1px 3px #000',WebkitTextStroke:'1px #000',paintOrder:'stroke fill',padding:'12px 18px',boxSizing:'border-box',borderRadius:20,background:broll?'#06131095':'linear-gradient(90deg,transparent,#06131065,transparent)'}}>{wordTexts.join(' ')}</div>)}
  </div>}
  {isPreview&&!hideGraphics&&<div data-safe-zone-status={safeZones.status} role="status" style={{position:'absolute',top:8,left:8,right:8,font:'12px system-ui',color:'#fff',textShadow:'0 1px 3px #000',pointerEvents:'none'}}>
   {!aware?'UNASSESSED: legacy layout has no destination profiles.':<>Caption targets: {safeZones.profiles.map((x:any)=>`${x.platform} (${x.confidence})`).join(', ')}. {safeZones.findings.some((x:any)=>x.severity==='error')?'Critical content needs verification; protected export is blocked. ':''}{safeZones.findings.some((x:any)=>x.code.startsWith('FOCAL_')&&x.severity==='warning')?'Focal/action framing needs review. ':''}Profile conformance does not guarantee every platform UI.</>}
  </div>}
 </AbsoluteFill>;
};
