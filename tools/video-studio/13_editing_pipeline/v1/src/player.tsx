import React,{useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {Player} from '@remotion/player';
import {Film} from './Film';
import {validateProject} from '../project.mjs';
function App(){const[p,setProject]=useState<any>(null),[error,setError]=useState(''),[ready,setReady]=useState(false);useEffect(()=>{const c=new AbortController();fetch('/project.json',{signal:c.signal}).then(r=>{if(!r.ok)throw Error('Project unavailable');return r.json();}).then(x=>{validateProject(x);setProject(x);}).catch(e=>{if(e.name!=='AbortError')setError(e.message);});const check=()=>fetch('/status.json',{signal:c.signal}).then(r=>r.json()).then(s=>setReady(s.ready===true)).catch(()=>{});check();const timer=setInterval(check,5000);return()=>{c.abort();clearInterval(timer);};},[]);
 return <main><header><img src="/logo.png" alt=""/><div><strong>Everywhere Poster</strong><p>Review your edit</p></div></header>{error?<p role="alert">{error}</p>:p?<><div className="player"><Player component={Film} inputProps={{project:p,preview:true}} durationInFrames={validateProject(p).frames} fps={p.canvas.fps} compositionWidth={p.canvas.width} compositionHeight={p.canvas.height} controls clickToPlay doubleClickToFullscreen style={{width:'100%'}}/></div><p className="note">Preview uses lighter footage. Export retains {p.canvas.width} × {p.canvas.height} resolution.</p>{ready?<a className="download" href="/final.mp4" download>Download finished edit</a>:<p className="note" role="status">The full-resolution export is being prepared and checked.</p>}<p className="note">Review before publishing. Nothing is posted automatically.</p></>:<p role="status">Loading your edit…</p>}</main>;
}
createRoot(document.getElementById('root')!).render(<App/>);
