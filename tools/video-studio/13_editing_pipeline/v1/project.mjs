// JSON is the boundary between the AI director, Cooked, preview and export.
import {assessSafeZones,safeZoneCacheContent} from './safe-zones.mjs';
export const EFFECTS = ['CinematicGrade','PersonPopOut','ImageCollage','ChatDrop','ShoulderZoom','AppleKeyCards','DynamicChecklist','MatchCut','VelocityLineGraph','IrisEffect','ProductDemo','FreebieDoc','ZoomThroughCut','CursorTracker','PixelatedCloseUp'];
export const frameCount = p => p.cuts.reduce((n,c)=>n+c.out-c.in,0);
export const audioTimeline = p => ({sourceSha256:p.source.sha256,fps:p.canvas.fps,cuts:p.cuts.map(c=>[c.in,c.out])});
export function assertPreparedProject(p,receipt,audioHash){
  if(JSON.stringify(audioTimeline(p))!==JSON.stringify(receipt.audioTimeline)||receipt.audioSha256!==audioHash)throw Error('Source/cuts/audio changed: prepare and realign a new revision before rendering');
}
const fail = s => {throw new Error(s);};
const number = (v,min,max) => typeof v==='number'&&Number.isFinite(v)&&v>=min&&v<=max;
const integer = (v,min,max) => Number.isInteger(v)&&number(v,min,max);
const text = (v,max=400) => typeof v==='string'&&v.trim().length>0&&v.length<=max;
export const overlaps = (a,b) => a.x<b.x+b.width&&a.x+a.width>b.x&&a.y<b.y+b.height&&a.y+a.height>b.y;
export function chunkContent(p,first,last){
  let cursor=0;
  const cuts=p.cuts.map(c=>{const from=cursor;cursor+=c.out-c.in;return{...c,from};}).filter(c=>c.from<=last&&c.from+c.out-c.in>first);
  const words=new Map(p.words.map(w=>[w.id,w]));
  const captions=p.captions.filter(c=>words.get(c.wordIds[0]).start*p.canvas.fps<=last&&(words.get(c.wordIds.at(-1)).end+.12)*p.canvas.fps>first).map(c=>({...c,words:c.wordIds.map(id=>words.get(id))}));
  const active=events=>events.filter(e=>e.from<=last&&e.from+e.frames>first);
  // Editorial notes/revision labels do not change pixels; timed decisions do.
  return {first,last,canvas:p.canvas,source:p.source,assets:p.assets.map(({originalPath,previewFile,...a})=>a),cuts,captions,broll:active(p.broll),effects:active(p.effects),safeZones:safeZoneCacheContent(p)};
}
export function validateProject(p){
  if(!p||p.schemaVersion!==1||!text(p.id,80)||!integer(p.revision,1,10000))fail('Unsupported project identity/version');
  if(!p.canvas||!integer(p.canvas.width,320,3840)||!integer(p.canvas.height,320,3840)||p.canvas.width%2||p.canvas.height%2||!integer(p.canvas.fps,24,60)||Math.abs(p.canvas.width/p.canvas.height-9/16)>.001)fail('Expected an even-sized portrait canvas');
  if(!p.source||!integer(p.source.frames,1,60*60*30)||!/^[a-f0-9]{64}$/.test(p.source.sha256)||!text(p.source.assetId,80))fail('Invalid source provenance');
  if(!Array.isArray(p.assets)||!p.assets.length||p.assets.length>100)fail('Invalid asset inventory');
  const assets=new Map();
  for(const a of p.assets){
    if(!text(a.id,80)||assets.has(a.id)||!['video','image'].includes(a.kind)||!/^assets\/[a-zA-Z0-9_.-]+$/.test(a.file)||!/^[a-f0-9]{64}$/.test(a.sha256)||!text(a.evidence,1000))fail('Invalid or duplicate asset');
    if(a.previewFile&&!/^assets\/[a-zA-Z0-9_.-]+$/.test(a.previewFile))fail('Unsafe preview path');
    if(a.kind==='video'&&(!number(a.duration,0.01,1800)||!number(a.fps,1,120)))fail('Missing video clock');
    assets.set(a.id,a);
  }
  if(assets.get(p.source.assetId)?.sha256!==p.source.sha256)fail('Source/asset identity mismatch');
  if(!Array.isArray(p.cuts)||!p.cuts.length||p.cuts.length>1000)fail('Missing bounded cuts');
  let previous=0;
  for(const c of p.cuts){if(!integer(c.in,previous,p.source.frames-1)||!integer(c.out,c.in+1,p.source.frames)||!text(c.reason))fail('Cuts must preserve source order and bounds');previous=c.out;}
  const frames=frameCount(p),seconds=frames/p.canvas.fps;
  if(!Array.isArray(p.words)||!p.words.length||p.words.length>20000)fail('Missing aligned transcript');
  const words=new Map();let wordStart=-1;
  for(const w of p.words){if(!text(w.id,80)||words.has(w.id)||!text(w.text,100)||!number(w.start,0,seconds)||!number(w.end,w.start,seconds+.05)||w.start<wordStart)fail('Invalid transcript clock');words.set(w.id,w);wordStart=w.start;}
  if(!Array.isArray(p.captions)||!p.captions.length)fail('Missing captions');
  const captionIds=p.captions.flatMap(c=>c.wordIds);
  if(JSON.stringify(captionIds)!==JSON.stringify(p.words.map(w=>w.id)))fail('Captions must preserve every word once and in order');
  for(const c of p.captions)if(!Array.isArray(c.wordIds)||!c.wordIds.length||c.wordIds.length>8||c.wordIds.some(id=>!words.has(id)))fail('Invalid caption group');
  if(!p.speaker||p.speaker.count!==1||!Array.isArray(p.speaker.faces)||!p.speaker.faces.length)fail('This pilot requires observed single-speaker framing');
  for(const f of p.speaker.faces)if(!number(f.t,0,seconds+.5)||!['x','y','width','height'].every(k=>number(f[k],0,1920)))fail('Invalid face observation');
  if(!Array.isArray(p.broll)||p.broll.length>100||!Array.isArray(p.effects)||p.effects.length>100)fail('Invalid visual tracks');
  const eventIds=new Set();
  for(const e of [...p.broll,...p.effects]){
    if(!text(e.id,80)||eventIds.has(e.id)||!integer(e.from,0,frames-1)||!integer(e.frames,1,frames-e.from)||!text(e.reason,1000)||!Array.isArray(e.anchorWords)||!e.anchorWords.length||e.anchorWords.some(id=>!words.has(id)))fail('Invalid event or missing narration evidence');
    eventIds.add(e.id);
    const anchor=words.get(e.anchorWords[0]);if(Math.abs(e.from/p.canvas.fps-anchor.start)>2)fail('Visual cue is detached from its narration anchor');
  }
  for(const e of p.broll){const a=assets.get(e.assetId);if(!a)fail('Unknown B-roll asset');if(a.kind==='video'&&(!number(e.sourceStart,0,a.duration)||e.sourceStart+e.frames/p.canvas.fps>a.duration+.001))fail('B-roll exceeds source');}
  const ordered=[...p.broll].sort((a,b)=>a.from-b.from);for(let i=1;i<ordered.length;i++)if(ordered[i].from<ordered[i-1].from+ordered[i-1].frames)fail('Overlapping B-roll');
  for(const e of p.effects){
    if(!EFFECTS.includes(e.type)||!e.props||typeof e.props!=='object'||Array.isArray(e.props))fail('Unsupported effect');
    if(e.type==='PersonPopOut')fail('PersonPopOut needs a revision-bound matte adapter; unavailable in this pilot');
    if(['CinematicGrade','MatchCut','ZoomThroughCut','ShoulderZoom'].includes(e.type))fail('Full-frame effects need a separate speaker/framing adapter; unavailable in this pilot');
    const b=e.bounds;if(!b||!['x','y','width','height'].every(k=>number(b[k],0,1920))||b.width<=0||b.height<=0||b.x<60||b.x+b.width>1020||b.y<0||b.y+b.height>1440)fail('Effect exceeds portrait or caption safe area');
    if(p.speaker.faces.some(f=>f.t>=e.from/p.canvas.fps-.5&&f.t<=(e.from+e.frames)/p.canvas.fps+.5&&overlaps(b,{x:f.x-20,y:f.y-20,width:f.width+40,height:f.height+40})))fail('Effect intersects observed speaker');
    if(e.assetId&&!assets.has(e.assetId))fail('Unknown effect asset');
    const forbidden=['start','duration','position','scale','width','height','safeArea','easing','children','src','source','before','after','matteFolder','backdrop'];
    if(Object.keys(e.props).some(k=>forbidden.includes(k)))fail('Effect props cannot override validated media or geometry');
    // No paths or URLs may bypass the asset registry in nested props.
    const scan=v=>{if(v&&typeof v==='object'){for(const [k,x]of Object.entries(v)){if(['src','source','url','file','path','__proto__','constructor','prototype'].includes(k))fail('Unsafe nested effect property');scan(x);}}else if(typeof v==='number'&&!number(v,-10000,10000))fail('Unbounded effect parameter');else if(typeof v==='string'&&(v.length>1000||/https?:|file:|\.\.\//.test(v)))fail('Unsafe effect string');};scan(e.props);
    if(['IrisEffect','ProductDemo','FreebieDoc','PixelatedCloseUp'].includes(e.type)&&!e.assetId)fail('Effect requires a registered media asset');
    if(['FreebieDoc','PixelatedCloseUp'].includes(e.type)&&assets.get(e.assetId)?.kind!=='image')fail('Effect requires a still image');
    if(e.assetId&&assets.get(e.assetId)?.kind==='video'&&(!number(e.sourceStart??0,0,assets.get(e.assetId).duration)||(e.sourceStart??0)+e.frames/p.canvas.fps>assets.get(e.assetId).duration))fail('Effect video exceeds source');
    if(e.type==='ImageCollage'){
      if(!Array.isArray(e.props.images)||!e.props.images.length||e.props.images.length>8)fail('Invalid collage');
      const ids=new Set();for(const im of e.props.images){if(!text(im.id,80)||ids.has(im.id)||assets.get(im.assetId)?.kind!=='image'||!number(im.at,0,e.frames/p.canvas.fps-.3)||!number(im.x,0,b.width)||!number(im.y,0,b.height)||!number(im.width,1,b.width-im.x)||!number(im.height,1,b.height-im.y))fail('Invalid collage image or bounds');ids.add(im.id);}
    }
    const requirements={ChatDrop:'messages',DynamicChecklist:'items',AppleKeyCards:'cards',ProductDemo:'camera',VelocityLineGraph:'points',CursorTracker:'path'};
    if(requirements[e.type]&&(!Array.isArray(e.props[requirements[e.type]])||!e.props[requirements[e.type]].length||e.props[requirements[e.type]].length>24))fail('Effect needs bounded configuration');
  }
  if(!p.director||!text(p.director.summary,3000)||!Array.isArray(p.director.decisions))fail('Missing AI direction record');
  for(const cue of p.instructions?.requiredCues??[]){if(!text(cue.id,80)||!EFFECTS.includes(cue.effect)||p.effects.filter(e=>e.directiveId===cue.id&&e.type===cue.effect).length!==1)fail('An explicit script effect cue was lost');}
  return {frames,seconds,assets,words,safeZones:assessSafeZones(p,frames)};
}
