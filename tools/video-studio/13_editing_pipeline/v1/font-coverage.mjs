// Read Unicode cmap 4/12 from the verified static TTFs. A loaded FontFace alone
// permits browser fallback for missing glyphs; reject those strings explicitly.
export function fontCoversText(buffer,text){
 const v=new DataView(buffer),tables=[];let cmap;
 for(let i=0;i<v.getUint16(4);i++){const p=12+i*16;if(v.getUint32(p)===0x636d6170)cmap=v.getUint32(p+8);}
 if(cmap===undefined)throw Error('Font has no Unicode cmap');
 for(let i=0;i<v.getUint16(cmap+2);i++){
  const p=cmap+4+i*8,platform=v.getUint16(p),encoding=v.getUint16(p+2),offset=cmap+v.getUint32(p+4),format=v.getUint16(offset);
  if((platform===0||platform===3&&[1,10].includes(encoding))&&[4,12].includes(format))tables.push({offset,format});
 }
 const glyph=(code,{offset:o,format})=>{
  if(format===12){let low=0,high=v.getUint32(o+12)-1;
   while(low<=high){const i=(low+high)>>>1,p=o+16+i*12,start=v.getUint32(p),end=v.getUint32(p+4);if(code<start)high=i-1;else if(code>end)low=i+1;else return v.getUint32(p+8)+code-start;}return 0;
  }
  if(code>65535)return 0;
  const count=v.getUint16(o+6)/2,end=o+14,start=end+count*2+2,delta=start+count*2,range=delta+count*2;
  for(let i=0;i<count;i++)if(code<=v.getUint16(end+i*2)){
   if(code<v.getUint16(start+i*2))return 0;
   const distance=v.getUint16(range+i*2),adjust=v.getInt16(delta+i*2);
   if(!distance)return (code+adjust)&65535;
   const g=v.getUint16(range+i*2+distance+(code-v.getUint16(start+i*2))*2);return g?(g+adjust)&65535:0;
  }return 0;
 };
 const selected=tables.sort((a,b)=>b.format-a.format)[0];if(!selected)throw Error('Font has no supported Unicode cmap');
 return [...text].every(character=>glyph(character.codePointAt(0),selected)!==0);
}
