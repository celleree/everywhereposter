import {checkContentBounds} from './safe-zones.mjs';
import {ACCEPTED_STYLE} from './accepted-style.mjs';

const finite=Number.isFinite;
const overlap=(a,b)=>a.x<b.x+b.width&&a.x+a.width>b.x&&a.y<b.y+b.height&&a.y+a.height>b.y;
const polygon=b=>[[b.x/1080,b.y/1920],[(b.x+b.width)/1080,b.y/1920],[(b.x+b.width)/1080,(b.y+b.height)/1920],[b.x/1080,(b.y+b.height)/1920]];
export const TITLE_STYLE=Object.freeze({font:'700 96px "EP Plex"',fontSize:96,lineHeight:110,padding:24});
export function validateTitle(title,p,frames,cells){
 if(p.editorStyle===ACCEPTED_STYLE){
  if(!title||Object.keys(title).sort().join(',')!=='bounds,frames,from,style,text,version,wordIds'||title.version!==1||title.style!==ACCEPTED_STYLE||typeof title.text!=='string'||!title.text.trim()||title.text.length>60||/[\r\n]/.test(title.text)||!Array.isArray(title.wordIds)||title.wordIds.some(id=>!p.words.some(w=>w.id===id))||title.from!==0||title.frames!==Math.min(135,frames)||!title.bounds||Object.keys(title.bounds).sort().join(',')!=='height,width,x,y'||Object.entries({x:108,y:276,width:720,height:132}).some(([k,v])=>title.bounds[k]!==v))throw Error('Invalid approved headline. Edit the headline and retry.');
  return title;
 }
 if(!title||typeof title!=='object'||Array.isArray(title)||Object.keys(title).sort().join(',')!=='bounds,frames,from,style,text,version,wordIds'||title.version!==1||title.style!=='block-title-v1')throw Error('Invalid title contract');
 if(!Array.isArray(title.wordIds)||title.wordIds.length<3||title.wordIds.length>9)throw Error('Title needs 3-9 contiguous source words');
 const start=p.words.findIndex(w=>w.id===title.wordIds[0]),slice=p.words.slice(start,start+title.wordIds.length);
 if(start<0||JSON.stringify(slice.map(w=>w.id))!==JSON.stringify(title.wordIds)||title.text!==slice.map(w=>w.text).join(' ')||title.text.length>60)throw Error('Title text must exactly match contiguous source words');
 if(!Number.isInteger(title.from)||!Number.isInteger(title.frames)||title.from<0||title.frames<60||title.frames>120||title.from+title.frames>frames)throw Error('Invalid title interval');
 const b=title.bounds;
 if(!b||Object.keys(b).sort().join(',')!=='height,width,x,y'||!['x','y','width','height'].every(k=>finite(b[k]))||b.x<0||b.y<0||b.y>768||b.width<180||b.height<120||b.width>1080||b.height>600||b.x+b.width>1080||b.y+b.height>1920||!cells.length||!checkContentBounds(polygon(b),cells).valid)throw Error('Unsafe title bounds');
 if(p.speaker.faces.some(f=>overlap(b,{x:f.x-20,y:f.y-20,width:f.width+40,height:f.height+40})))throw Error('Title intersects observed face');
 return title;
}
export function titleForCaption(title,range){
 return title&&range[0]<title.from+title.frames&&range[1]>title.from?title.bounds:null;
}
export function planTitle(text,box,measure){
 const style=TITLE_STYLE,inner=box.width-2*style.padding,lines=[];let words=[];
 const metric=text=>{const m=measure(text);if(!m||!['width','left','right','ascent','descent'].every(k=>finite(m[k]))||m.width<=0||m.ascent<0||m.descent<0)throw Error('Title requires actual font metrics');return m;};
 const fits=text=>{const m=metric(text);return Math.max(m.width,m.right)+Math.max(0,m.left)<=inner;};
 for(const word of text.split(' ')){
  if(!word||!fits(word))throw Error('Title cannot fit at 96px; adjustment required');
  if(words.length&&!fits([...words,word].join(' '))){lines.push(words.join(' '));words=[];}
  words.push(word);
 }
 if(words.length)lines.push(words.join(' '));
 const metrics=lines.map(metric),lineHeight=Math.max(style.lineHeight,...metrics.map(m=>m.ascent+m.descent));
 if(lines.length>2||lines.length*lineHeight+2*style.padding>box.height)throw Error('Title cannot fit at 96px; adjustment required');
 const top=(box.height-lines.length*lineHeight)/2;
 return {box,lines:lines.map((text,i)=>({text,x:(box.width-metrics[i].width)/2,baseline:top+i*lineHeight+metrics[i].ascent})),fontSize:style.fontSize};
}
export function assertMeasuredTitle(box,glyphs){
 if(!glyphs.length)throw Error('No measured title glyphs');
 for(const b of glyphs)if(![b.x,b.y,b.width,b.height].every(finite)||b.width<=0||b.height<=0||b.x<0||b.y<0||b.x+b.width>box.width||b.y+b.height>box.height)throw Error('Rendered title glyph exceeds its box');
}
