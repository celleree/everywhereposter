// Exact arithmetic over serialized decimal source times and integer frame maps.
export function decimal(value){
 if(!Number.isFinite(value))throw Error('Invalid source time');
 const negative=value<0,[coefficient,exponent='0']=String(Math.abs(value)).toLowerCase().split('e'),parts=coefficient.split('.');
 let n=BigInt(parts.join('')),d=1n;const places=(parts[1]?.length??0)-Number(exponent);
 if(places>0)d=10n**BigInt(places);else n*=10n**BigInt(-places);
 return {n:negative?-n:n,d};
}
export const add=(a,b)=>({n:a.n*b.d+b.n*a.d,d:a.d*b.d});
export const subtract=(a,b)=>add(a,{n:-b.n,d:b.d});
export const compare=(a,b)=>a.n*b.d-b.n*a.d;
export const mappedTime=(word,end=false)=>add(decimal(end?word.sourceEnd??word.end:word.sourceStart??word.start),{n:BigInt(word.frameOffset??0),d:30n});
export function frame(time){
 if(time.n<0n)throw Error('Invalid caption endpoint');
 const n=time.n*30n;return Number((n*2n+time.d)/(time.d*2n));
}
