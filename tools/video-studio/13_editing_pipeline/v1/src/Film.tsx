import React,{useEffect,useMemo,useState} from 'react';
import {AbsoluteFill,Audio,Img,OffthreadVideo,Sequence,cancelRender,continueRender,delayRender,getRemotionEnvironment,staticFile,useCurrentFrame,useVideoConfig} from 'remotion';
import {ChatDrop,DynamicChecklist,ImageCollage,AppleKeyCards,IrisEffect,ProductDemo,FreebieDoc,VelocityLineGraph,CursorTracker,PixelatedCloseUp} from '../../../12_effect_library/v2/src';
import {validateProject} from '../project.mjs';
export function Font(){const[h]=useState(()=>delayRender('Local editorial font'));useEffect(()=>{document.fonts.load('700 72px "EP Plex"').then(f=>{if(!f.length)throw Error('Missing local font');continueRender(h);}).catch(cancelRender);},[h]);return <style>{`@font-face{font-family:'EP Plex';src:url('${staticFile('font.ttf')}');font-weight:700;font-display:block}`}</style>;}
const media=(a:any,preview:boolean)=>staticFile(preview&&a.previewFile?a.previewFile:a.file);
function Effect({event:e,assets}:any){
 const {fps}=useVideoConfig();const p={...e.props,start:0,duration:e.frames/fps,position:[e.bounds.x,e.bounds.y] as const,width:e.bounds.width,height:e.bounds.height,safeArea:{x:60,y:0,width:960,height:1440}};
 const a=e.assetId?assets.get(e.assetId):null;
 const source=a?{src:a.file,kind:a.kind,sourceStart:e.sourceStart??0}:null;
 switch(e.type){
 case'ChatDrop':return <ChatDrop {...p}/>;case'DynamicChecklist':return <DynamicChecklist {...p}/>;
 case'AppleKeyCards':return <AppleKeyCards {...p}/>;case'VelocityLineGraph':return <VelocityLineGraph {...p}/>;
 case'CursorTracker':return <CursorTracker {...p}/>;
 case'ProductDemo':return <ProductDemo {...p} source={source}/>;
 case'FreebieDoc':return <FreebieDoc {...p} src={a.file}/>;
 case'PixelatedCloseUp':return <PixelatedCloseUp {...p} src={a.file}/>;
 case'IrisEffect':return <IrisEffect {...p}>{a.kind==='image'?<Img src={staticFile(a.file)} style={{width:'100%',height:'100%',objectFit:'cover'}}/>:<OffthreadVideo muted src={staticFile(a.file)} startFrom={Math.round((e.sourceStart??0)*fps)} style={{width:'100%',height:'100%',objectFit:'cover'}}/>}</IrisEffect>;
 case'ImageCollage':return <ImageCollage {...p} images={e.props.images.map((im:any)=>({...im,src:assets.get(im.assetId).file}))}/>;
 default:throw Error(`Unsupported effect ${e.type}`);
 }
}
export const Film:React.FC<{project:any;preview?:boolean;hideGraphics?:boolean}>=({project:p,preview=false,hideGraphics=false})=>{
 const{assets,words}=useMemo(()=>validateProject(p),[p]),frame=useCurrentFrame(),{fps,width,height}=useVideoConfig();
 const isPreview=preview&&!getRemotionEnvironment().isRendering,source=assets.get(p.source.assetId);let cursor=0;
 const caption=p.captions.find((c:any)=>frame>=Math.floor(words.get(c.wordIds[0]).start*fps)&&frame<Math.ceil(Math.min(words.get(c.wordIds.at(-1)).end+.12,p.words.at(-1).end)*fps));
 const broll=p.broll.find((b:any)=>frame>=b.from&&frame<b.from+b.frames);
 return <AbsoluteFill style={{background:'#101714',fontFamily:'EP Plex',fontWeight:700,color:'#fff'}}><Font/>
  {p.cuts.map((c:any,i:number)=>{const from=cursor;cursor+=c.out-c.in;return <Sequence key={i} from={from} durationInFrames={c.out-c.in}><OffthreadVideo muted src={media(source,isPreview)} startFrom={c.in} endAt={c.out} style={{width:'100%',height:'100%',objectFit:'cover'}}/></Sequence>;})}
  {!hideGraphics&&p.broll.map((b:any)=>{const a=assets.get(b.assetId);return <Sequence key={b.id} from={b.from} durationInFrames={b.frames}>{a.kind==='video'?<OffthreadVideo muted src={media(a,isPreview)} startFrom={Math.round(b.sourceStart*fps)} style={{width:'100%',height:'100%',objectFit:'cover'}}/>:<Img src={media(a,isPreview)} style={{width:'100%',height:'100%',objectFit:'cover'}}/>}</Sequence>;})}
  <Audio src={staticFile('speech.wav')}/>
  {!hideGraphics&&<div style={{position:'absolute',width:1080,height:1920,transform:`scale(${width/1080},${height/1920})`,transformOrigin:'0 0'}}>
   {p.effects.map((e:any)=><Sequence key={e.id} from={e.from} durationInFrames={e.frames}><Effect event={e} assets={assets}/></Sequence>)}
   {caption&&<div data-caption={caption.wordIds.join(',')} style={{position:'absolute',left:80,top:1500,width:920,minHeight:180,display:'flex',alignItems:'center',justifyContent:'center',textAlign:'center',fontSize:76,lineHeight:1.12,letterSpacing:'-.025em',textShadow:'0 3px 12px #000,0 1px 3px #000',WebkitTextStroke:'1px #000',paintOrder:'stroke fill',padding:'12px 18px',boxSizing:'border-box',borderRadius:20,background:broll?'#06131095':'linear-gradient(90deg,transparent,#06131065,transparent)'}}>{caption.wordIds.map((id:string)=>words.get(id).text).join(' ')}</div>}
  </div>}
 </AbsoluteFill>;
};
