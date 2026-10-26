// Accessible layouts adapted from the owned Easy HeaderArt/Integration components.
// Geometry is shared by preview, export and tests. Text ink is measured in-browser.
export const EASY_PROFILE='easy-graphics-v1';
export const EASY_EFFECTS=['EasyRelationship','EasyMediaPanels'];
export const ICONS=['recording','document','conversation','product'];
const keys=(o,allowed)=>o&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).every(k=>allowed.includes(k));
const label=(s,max=48)=>typeof s==='string'&&s.trim().length>0&&s.length<=max&&!/[\u0000-\u001f]/.test(s);
export function validateEasyEffect(e,assets,fps=30){
 const p=e.props;
 if(!EASY_EFFECTS.includes(e.type)||!keys(p,e.type==='EasyRelationship'?['layout','heading','nodes','theme']:['heading','panels','theme'])||!['light','dark'].includes(p.theme))throw Error('Invalid accessible effect');
 if(p.heading!==undefined&&!label(p.heading,60))throw Error('Invalid effect heading');
 const list=e.type==='EasyRelationship'?p.nodes:p.panels;
 if(!Array.isArray(list)||list.length<(e.type==='EasyRelationship'?2:1)||list.length>3)throw Error('Invalid effect item count');
 if(e.type==='EasyRelationship'&&(!['flow','split','exchange'].includes(p.layout)||p.layout!=='flow'&&list.length!==2))throw Error('Invalid relationship layout');
 if(e.type==='EasyRelationship'&&e.frames/fps<(list.length-1)*.25+.2)throw Error('Effect ends before its content is revealed');
 const ids=new Set();
 for(const n of list){
  if(!keys(n,e.type==='EasyRelationship'?['id','label','icon']:['id','assetId','label','at'])||!label(n.id,80)||ids.has(n.id))throw Error('Invalid effect item');ids.add(n.id);
  if(e.type==='EasyRelationship'){
   if(!label(n.label)||n.icon!==undefined&&!ICONS.includes(n.icon))throw Error('Invalid node content');
  }else if(assets.get(n.assetId)?.kind!=='image'||n.label!==undefined&&!label(n.label)||!Number.isFinite(n.at)||n.at<0||n.at+.3>e.frames/fps)throw Error('Invalid registered panel');
 }
 if(e.bounds.width<400||e.bounds.height<160)throw Error('Accessible effect region is too small');
}
export function easyLayout(e){
 const {x,y,width:w,height:h}=e.bounds,heading=e.props.heading;
 const list=e.type==='EasyRelationship'?e.props.nodes:e.props.panels,gap=24,col=(w-gap*(list.length-1))/list.length,top=heading?58:e.props.layout==='split'?32:8;
 const connectors=[];
 if(e.type==='EasyRelationship'){
  if(e.props.layout==='split'){
   const a=col/2,b=col+gap+col/2,k=top-8;connectors.push({d:`M${w/2} ${heading?46:8} V${k} M${a} ${top-2} V${k} H${b} V${top-2}`});
  }else for(let i=0;i<list.length-1;i++){
   const a=(i+1)*col+i*gap+3,b=(i+1)*(col+gap)-3,k=top+(h-top-8)/2;
   connectors.push({d:`M${a} ${k- (e.props.layout==='exchange'?10:0)} H${b} m-6 -6 l6 6 l-6 6`});
   if(e.props.layout==='exchange')connectors.push({d:`M${b} ${k+10} H${a} m6 -6 l-6 6 l6 6`});
  }
 }
 return {heading:heading?{text:heading,x:x+w/2,y:y+34,fontSize:32,maxWidth:w-16}:null,items:list.map((n,i)=>({id:n.id,x:x+i*(col+gap),y:y+top,width:col,height:h-top-8,label:n.label,icon:n.icon,assetId:n.assetId,at:e.type==='EasyRelationship'?i*.25:n.at})),connectors};
}
export function fitLines(text,maxWidth,measure,fontSize=38){
 const words=text.split(/\s+/);const options=[text];
 for(let i=1;i<words.length;i++)options.push(words.slice(0,i).join(' ')+'\n'+words.slice(i).join(' '));
 const valid=options.map(s=>s.split('\n')).filter(lines=>lines.every(s=>measure(s,fontSize)<=maxWidth));
 if(!valid.length)throw Error('Effect text does not fit at readable size');
 return valid.sort((a,b)=>a.length-b.length||Math.max(...a.map(s=>measure(s,fontSize)))-Math.max(...b.map(s=>measure(s,fontSize))))[0];
}
export function assertEffectInk(e,boxes,cells){
 if(!boxes.length)throw Error('Missing measured effect content');
 for(const b of boxes){
  if(![b.x,b.y,b.width,b.height].every(Number.isFinite)||b.width<=0||b.height<=0)throw Error('Invalid measured ink');
  // Critical rectangles must fit a cell, conservatively rejecting notch crossings.
  if(b.x-3<0||b.y-3<0||b.x+b.width+3>e.bounds.width||b.y+b.height+3>e.bounds.height)throw Error('Effect ink escapes declared bounds');
  const r={x:(e.bounds.x+b.x-3)/1080,y:(e.bounds.y+b.y-3)/1920,width:(b.width+6)/1080,height:(b.height+6)/1920};
  if(!cells.some(c=>r.x>=c.x&&r.y>=c.y&&r.x+r.width<=c.x+c.width&&r.y+r.height<=c.y+c.height))throw Error('Effect critical content exceeds selected safe zones');
 }
}
