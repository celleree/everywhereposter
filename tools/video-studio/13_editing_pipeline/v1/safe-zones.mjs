import {EASY_PROFILE,EASY_EFFECTS} from './effect-content-bounds.mjs';
import {selectProfiles} from './safe-zone-profiles.mjs';

const EPS = 1e-10;
const finite = Number.isFinite;
const rectPolygon = r => [[r.x,r.y],[r.x+r.width,r.y],[r.x+r.width,r.y+r.height],[r.x,r.y+r.height]];
const area = points => Math.abs(points.reduce((n,p,i) => {const q=points[(i+1)%points.length]; return n+p[0]*q[1]-q[0]*p[1];},0))/2;
const intersectIntervals = (a,b) => a.flatMap(([l,r]) => b.map(([x,y]) => [Math.max(l,x),Math.min(r,y)]).filter(([x,y]) => y-x>EPS));
const atY = (polygon,y) => {
  const xs=[];
  polygon.forEach(([x,a],i) => {const [z,b]=polygon[(i+1)%polygon.length]; if((a<=y&&y<b)||(b<=y&&y<a)) xs.push(x+(z-x)*(y-a)/(b-a));});
  xs.sort((a,b)=>a-b); return xs.filter((_,i)=>i%2===0).map((x,i)=>[x,xs[2*i+1]]);
};
// The bounded registry uses simple orthogonal masks. Disjoint bands preserve notches.
export function intersectProfiles(profiles) {
  if (!profiles.length) throw Error('No selected safe-zone profiles');
  const ys=[...new Set(profiles.flatMap(p=>p.polygon.map(v=>v[1])))].sort((a,b)=>a-b),cells=[];
  for(let i=0;i<ys.length-1;i++) {
    const y=ys[i],height=ys[i+1]-y;
    const intervals=profiles.reduce((a,p)=>intersectIntervals(a,atY(p.polygon,y+height/2)),[[0,1]]);
    for(const [x,right] of intervals) cells.push({x,y,width:right-x,height});
  }
  if (!cells.length) throw Error('Selected profiles have no common usable area');
  return cells;
}
function clip(points,axis,limit,keepGreater) {
  const out=[];
  points.forEach((b,i)=>{
    const a=points[(i+points.length-1)%points.length],ai=keepGreater?a[axis]>=limit:a[axis]<=limit,bi=keepGreater?b[axis]>=limit:b[axis]<=limit;
    if(ai!==bi){const t=(limit-a[axis])/(b[axis]-a[axis]);out.push([a[0]+t*(b[0]-a[0]),a[1]+t*(b[1]-a[1])]);}
    if(bi)out.push(b);
  });
  return out;
}
const clipRect = (points,r) => clip(clip(clip(clip(points,0,r.x,true),0,r.x+r.width,false),1,r.y,true),1,r.y+r.height,false);
export function coverage(points,cells) {
  if(!Array.isArray(points)||points.length<3||points.some(p=>!Array.isArray(p)||p.length!==2||!p.every(finite))||area(points)<=EPS) throw Error('Invalid content polygon');
  return Math.min(1,Math.max(0,cells.reduce((n,r)=>n+area(clipRect(points,r)),0)/area(points)));
}
export function checkContentBounds(points,cells,role='critical') {
  if(!['critical','decorative'].includes(role))throw Error('Unknown content role');
  const fraction=coverage(points,cells);
  return {coverage:fraction,valid:role==='decorative'||fraction>=1-EPS};
}
export function checkFocalRegion(points,cells,essential=false) {
  const visibleCoverage=coverage(points,[{x:0,y:0,width:1,height:1}]),safeCoverage=coverage(points,cells);
  return {visibleCoverage,safeCoverage,status:essential&&visibleCoverage<=EPS?'ERROR':safeCoverage<.95?'WARNING':'WITHIN_TARGET'};
}
// Regions are source-normalized; Film's existing media uses centered object-fit:cover.
export function coverRegion(rect,asset,canvas) {
  const scale=Math.max(canvas.width/asset.width,canvas.height/asset.height);
  const x=(canvas.width-asset.width*scale)/2,y=(canvas.height-asset.height*scale)/2;
  return rectPolygon(rect).map(([a,b])=>[(x+a*asset.width*scale)/canvas.width,(y+b*asset.height*scale)/canvas.height]);
}
export function assessSafeZones(project,frames) {
  if(project.safeZones===undefined)return {status:'UNASSESSED',profiles:[],cells:[],findings:[{severity:'warning',code:'LEGACY_UNASSESSED'}]};
  const config=project.safeZones;
  if(!config||typeof config!=='object'||Array.isArray(config)||config.version!==1||Object.keys(config).some(k=>!['version','profiles','preset','focalRegions'].includes(k)))throw Error('Invalid safe-zone layout version or fields');
  const profiles=selectProfiles(config),cells=intersectProfiles(profiles),findings=[];
  for(const p of profiles)if(p.confidence!=='official')findings.push({severity:'warning',code:'PROFILE_NOT_OFFICIAL_ORGANIC',profile:p.id,confidence:p.confidence});
  // Caller-supplied boxes cannot certify motion/text inside the unavailable private effects.
  for(const e of project.effects){if(project.profile===EASY_PROFILE&&EASY_EFFECTS.includes(e.type))findings.push({severity:'info',code:'EFFECT_MEASUREMENT_REQUIRED',event:e.id});else findings.push({severity:'error',code:'UNVERIFIED_CRITICAL_EFFECT_BOUNDS',event:e.id});}
  const tracks=new Map([['source',{assetId:project.source.assetId,from:0,frames}],...project.broll.map(b=>[b.id,b])]);
  const regions=config.focalRegions??[],seen=new Set();
  if(!Array.isArray(regions)||regions.length>200)throw Error('Invalid focal-region inventory');
  for(const f of regions){
    const track=tracks.get(f?.track),r=f?.rect;
    if(!f||Object.keys(f).some(k=>!['id','track','from','frames','rect','essential'].includes(k))||typeof f.id!=='string'||!f.id.trim()||f.id.length>80||seen.has(f.id)||!track||
      !Number.isInteger(f.from)||!Number.isInteger(f.frames)||f.frames<1||f.from<track.from||f.from+f.frames>track.from+track.frames||
      !r||Object.keys(r).sort().join(',')!=='height,width,x,y'||![r.x,r.y,r.width,r.height].every(finite)||r.x<0||r.y<0||r.width<=0||r.height<=0||r.x+r.width>1||r.y+r.height>1||typeof f.essential!=='boolean')throw Error('Invalid or unbound focal region');
    seen.add(f.id);
    // Film places each B-roll event full-frame above the source. This known
    // layer occlusion needs no inferred subject/action detection or media reads.
    if(f.track==='source')for(const b of project.broll){
      const from=Math.max(f.from,b.from),end=Math.min(f.from+f.frames,b.from+b.frames);
      if(from<end)findings.push({severity:f.essential?'error':'warning',code:f.essential?'ESSENTIAL_FOCAL_CONTENT_FULLY_OCCLUDED':'FOCAL_CONTENT_OCCLUDED_BY_BROLL',region:f.id,event:b.id,from,frames:end-from});
    }
    const asset=project.assets.find(a=>a.id===track.assetId);
    if(!finite(asset.width)||!finite(asset.height)||asset.width<=0||asset.height<=0){findings.push({severity:'warning',code:'FOCAL_DIMENSIONS_UNASSESSED',region:f.id});continue;}
    const result=checkFocalRegion(coverRegion(r,asset,project.canvas),cells,f.essential);
    findings.push({severity:result.status==='ERROR'?'error':result.status==='WARNING'?'warning':'info',code:result.status==='ERROR'?'ESSENTIAL_FOCAL_CONTENT_FULLY_CROPPED':result.status==='WARNING'?'FOCAL_COVERAGE_BELOW_WARNING_TARGET':'FOCAL_WITHIN_WARNING_TARGET',region:f.id,...result});
  }
  for(const [id,t]of tracks){
    const spans=regions.filter(r=>r.track===id).sort((a,b)=>a.from-b.from);let end=t.from;
    for(const r of spans){if(r.from>end)break;end=Math.max(end,r.from+r.frames);}
    if(end<t.from+t.frames)findings.push({severity:'warning',code:'FOCAL_COVERAGE_UNASSESSED',track:id});
  }
  return {status:findings.some(f=>f.severity==='error')?'CRITICAL_CONTENT_UNVERIFIED':'TARGETS_SELECTED',profiles,cells,findings};
}
export function assertSafeZoneRender(assessment) {
  const errors=assessment.findings.filter(f=>f.severity==='error');
  if(errors.length)throw Error(`Safe-zone export blocked: ${errors.map(f=>`${f.code}:${f.event??f.region}`).join(', ')}`);
}
export function safeZoneCacheContent(project) {
  if(project.safeZones===undefined)return undefined;
  return {config:project.safeZones,profiles:selectProfiles(project.safeZones).map(p=>({id:p.id,version:p.version,polygon:p.polygon})),faces:project.speaker.faces};
}
// A candidate can span adjacent bands only where their horizontal intervals intersect.
export function usableRectangles(cells) {
  const ys=[...new Set(cells.flatMap(c=>[c.y,c.y+c.height]))].sort((a,b)=>a-b),result=[];
  for(let i=0;i<ys.length-1;i++){
    let intervals=[[0,1]];
    for(let j=i;j<ys.length-1;j++){
      const mid=(ys[j]+ys[j+1])/2;
      intervals=intersectIntervals(intervals,cells.filter(c=>mid>c.y&&mid<c.y+c.height).map(c=>[c.x,c.x+c.width]));
      for(const [x,right]of intervals)result.push({x,y:ys[i],width:right-x,height:ys[j+1]-ys[i]});
    }
  }
  return result;
}
const overlaps = (a,b) => a.x<b.x+b.width&&a.x+a.width>b.x&&a.y<b.y+b.height&&a.y+a.height>b.y;
export const CAPTION_STYLE=Object.freeze({fontSize:76,lineHeight:86,stroke:1,paddingX:18,paddingY:12,font:'700 76px "EP Plex"'});
export function planCaption(wordTexts,cells,measure,avoid=[]) {
  if(!Array.isArray(wordTexts)||!wordTexts.length||wordTexts.length>8||wordTexts.some(w=>typeof w!=='string'||!w.trim()))throw Error('Missing or unbounded caption words');
  const style=CAPTION_STYLE,candidates=[];
  const metric=text=>{
    const m=measure(text);
    if(!m||!['width','left','right','ascent','descent'].every(k=>finite(m[k]))||m.width<=0||m.ascent<0||m.descent<0)throw Error('Caption requires actual font metrics');
    return m;
  };
  for(const r of usableRectangles(cells)){
    const box={x:r.x*1080,y:r.y*1920,width:r.width*1080,height:r.height*1920};
    const inner=box.width-2*(style.paddingX+style.stroke),lines=[];let words=[];
    const fits=text=>{const m=metric(text);return Math.max(m.width,m.right)+Math.max(0,m.left)<=inner;};
    let failed=false;
    for(const word of wordTexts){
      if(!fits(word)){failed=true;break;}
      if(words.length&&!fits([...words,word].join(' '))){lines.push(words.join(' '));words=[];}
      words.push(word);
    }
    if(failed)continue;
    if(words.length)lines.push(words.join(' '));
    const metrics=lines.map(metric),lineHeight=Math.max(style.lineHeight,...metrics.map(m=>m.ascent+m.descent+2*style.stroke));
    const height=lines.length*lineHeight+2*style.paddingY;
    if(height>box.height)continue;
    const positions=[box.y+box.height-height,box.y,...avoid.flatMap(o=>[o.y-height,o.y+o.height])];
    for(const y of positions){
      if(y<box.y-EPS||y+height>box.y+box.height+EPS)continue;
      const placed={...box,y,height};if(avoid.some(o=>overlaps(placed,o)))continue;
      const measured=lines.map((text,i)=>{
        const m=metrics[i],x=(box.width-m.width)/2,baseline=style.paddingY+i*lineHeight+style.stroke+m.ascent;
        return {text,x,baseline,ink:{x:box.x+x-m.left-style.stroke,y:y+baseline-m.ascent-style.stroke,width:m.left+m.right+2*style.stroke,height:m.ascent+m.descent+2*style.stroke}};
      });
      if(measured.some(l=>!checkContentBounds(rectPolygon({x:l.ink.x/1080,y:l.ink.y/1920,width:l.ink.width/1080,height:l.ink.height/1920}),cells).valid))continue;
      candidates.push({box:placed,lines:measured,...style,lineHeight});
    }
  }
  candidates.sort((a,b)=>a.lines.length-b.lines.length||(b.box.y+b.box.height)-(a.box.y+a.box.height)||b.box.width-a.box.width);
  if(!candidates.length)throw Error('Caption cannot fit safely at readable size; re-layout required (no words dropped)');
  return candidates[0];
}
// Used on actual SVG glyph boxes after the local font loads, not just proposed metadata.
export function assertMeasuredCaption(box,glyphBoxes,cells,stroke=CAPTION_STYLE.stroke) {
  if(!glyphBoxes.length)throw Error('No measured caption glyphs');
  for(const b of glyphBoxes){
    if(![b.x,b.y,b.width,b.height].every(finite)||b.width<=0||b.height<=0)throw Error('Unmeasured caption glyph bounds');
    const r={x:(box.x+b.x-stroke)/1080,y:(box.y+b.y-stroke)/1920,width:(b.width+2*stroke)/1080,height:(b.height+2*stroke)/1920};
    if(!checkContentBounds(rectPolygon(r),cells).valid)throw Error('Rendered caption/stroke exceeds selected safe-zone profiles');
  }
}
