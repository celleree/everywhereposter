/** Small pinned-UI adapter. Authorization remains on every gateway route. */
export function adaptCookedReviewHtml(html: string) {
  const edit = "fetch('/edits',{method:'POST',body:JSON.stringify(body)})";
  if (html.split(edit).length !== 2 || !html.includes('id="txlines"')) throw new Error('UNSUPPORTED_NATIVE_REVIEW');
  html = html.replace(edit, "fetch('/edits',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...body,revision:S.revision})})");
  // The local upstream assumes every response is state/data. Gateway failures
  // must not poison S (makingEdit then throws forever) or cache an error as DATA.
  html = html.replace("const raw=await (await fetch('/state')).text();",
    "const stateResponse=await fetch('/state');if(!stateResponse.ok)throw new Error('Editor temporarily unavailable');const raw=await stateResponse.text();");
  html = html.replace("fetch('/data?k='+key(r)).then(x=>x.json())",
    "fetch('/data?k='+key(r)).then(x=>{if(!x.ok)throw new Error('Editor temporarily unavailable');return x.json()})");
  html = html.replace("DATA[key(r)]=j;txSig='';render()}).catch(()=>{})",
    "DATA[key(r)]=j;txSig='';render()}).catch(()=>{delete DATA[key(r)];lastRaw=''})");
  html = html.replace('load();setInterval(load,3000);', 'load().catch(()=>{});setInterval(()=>load().catch(()=>{}),3000);');
  // Relative URLs keep the browser's authenticated public reverse-proxy prefix.
  html = html.replace(/(['"])(\/(?:state|data|video|download|edits|frames|ask\.js|theme|event|back|update|intro|comment|edit|scope|delete|check|keep|undo|trials|assets)(?:[?\/][^'"\s]*)?)\1/g,
    (_, quote: string, path: string) => quote + '.' + path + quote);
  html = html.replace('<script src="./ask.js"></script>', '');
  // Guard each patched native contract; an upstream change must fail closed.
  const patches = [
    ["const txEditable=()=>view.stage==='cut'&&isCur()&&!pending()&&!S.raw&&!!data().transcript;", 'const txEditable=()=>false;'],
    ["const noteOk=()=>!!S&&isCur()&&pending()!=='approve'&&!previewOn;", 'const noteOk=()=>false;'],
    ['async function load(force){', 'async function nativeLoad(force){'],
    ['load().catch(()=>{});setInterval(()=>load().catch(()=>{}),3000);', ''],
  ];
  for (const [before, after] of patches) {
    if (html.split(before).length !== 2) throw new Error('UNSUPPORTED_NATIVE_REVIEW');
    html = html.replace(before, after);
  }
  if (!html.includes('</body>') || !html.includes('id="stage"')) throw new Error('UNSUPPORTED_NATIVE_REVIEW');
  const css = `<style>
  .rail,#stages,#statusbox,#mapprove,#intro,#how,#stagebar,#ask,#askbar,.ask,aside,
  #approve,#send,#safebtn,.themebtn,#oldbadge,#txbar,#txtools,#rsztx,#rszside,
  #timeline,#box,#adds,#howbtn,.hits{display:none!important}
  html,body{height:auto!important;min-height:0!important;overflow-x:hidden;overflow-y:auto}
  body{display:block}.app{width:100%;height:auto;min-height:0!important;margin:0!important}
  main,.left,.stagewrap{min-width:0;flex:none}main{display:block}.left{padding:12px;gap:12px}
  header{height:44px;padding:0 12px}.homebtn{display:none!important}
  body #stage,body.withTx #stage,body.withTx:not(.vertical) #stage{container-type:normal;flex:none;height:auto;display:flex;flex-direction:column;gap:12px}
  body #pair,body.withTx #pair,body.withTx:not(.vertical) #pair{width:100%;height:auto;flex:none;gap:12px}
  body .pl,body.withTx .pl,body.withTx:not(.vertical) .pl{width:100%;height:auto;max-width:720px}
  body.compare .pl{width:calc((100% - 12px)/2)!important;height:auto!important}
  body .player,body.withTx:not(.vertical) .player{height:auto;aspect-ratio:var(--arw)/var(--arh);max-height:440px}
  body.vertical .pl{max-width:280px}
  body.withTx #tx,body.withTx:not(.vertical) #tx{display:flex!important;width:100%;height:300px;min-height:0;flex:none}
  #txlines{padding:10px 8px 24px;touch-action:pan-y}#txlines .tw{touch-action:pan-y}
  body.canCompare #cmprow{display:flex!important}body.compare #p2{display:flex!important}
  #cmprow{flex-wrap:wrap;gap:8px}#cmprow .lead{flex-wrap:wrap;gap:8px}
  #cmprow .hint{min-width:0}#ver2{max-width:100%;min-height:44px}.transport{flex-wrap:wrap;height:auto;min-height:40px}
  #ep-blocks{border:1px solid var(--line);border-radius:12px;padding:12px;overflow-wrap:anywhere}
  #ep-blocks h2{font-size:15px;margin:0 0 8px}#ep-blocks p{margin:8px 0}
  #ep-block-list{display:flex;flex-wrap:wrap;gap:8px}
  #ep-blocks button{border:1px solid var(--line2);border-radius:8px;padding:10px;min-height:44px;text-align:left}
  #ep-blocks button:disabled{opacity:.55}#ep-retry[hidden]{display:none}
  @media(max-width:760px){body .pl{max-width:100%}body.vertical .pl{max-width:220px}
  body.withTx #tx,body.withTx:not(.vertical) #tx{height:260px}.txhead{padding:10px}.transport{gap:8px;padding:0}}
  </style>`;
  // This script runs after the pinned native script has initialized its globals.
  const controls = `<script id="ep-review-adapter">(()=>{
  const request=new URL(location.href).searchParams.get('request');
  const job=location.pathname.split('/').slice(-2,-1)[0];
  const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const panel=document.createElement('section');panel.id='ep-blocks';panel.setAttribute('aria-label','Whole-block edits');
  panel.innerHTML='<h2>Whole-block edits</h2><p id="ep-block-status" role="status" aria-live="polite"></p><button id="ep-retry" type="button" hidden>Retry loading editing controls</button><div id="ep-block-list"></div>';
  document.querySelector('.left').append(panel);
  const status=document.getElementById('ep-block-status'),list=document.getElementById('ep-block-list'),retry=document.getElementById('ep-retry');
  let receipt=null,busy=false,uncertain=true,refreshing=false,stopped=false,message='Loading editing controls…',frame=0;
  const notify=()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>parent.postMessage({type:'ep-cooked-review',height:Math.ceil(document.body.getBoundingClientRect().height),busy:busy||refreshing||!!S?.busy},location.origin))};
  const equal=(a,b)=>a[0]===b[0]&&a[1]===b[1];
  function validate(r){
    const e=r?.editing,range=a=>Array.isArray(a)&&a.length===2&&a.every(Number.isFinite)&&a[0]>=0&&a[0]<a[1]&&a[1]<=Number.MAX_SAFE_INTEGER;
    if(!uuid.test(request||'')||r?.requestId!==request||r.jobId!==job||r.status!=='ready'||!Number.isSafeInteger(r.revision)||r.revision<0||e?.mode!=='quiet-block-v1'||e.wordCuts!==false||e.arbitraryPhrases!==false||e.pauseEdits!==false||!Array.isArray(e.blocks)||!Array.isArray(e.removedBlocks)||!e.blocks.every(range)||!e.removedBlocks.every(range))throw Error('Editing controls unavailable. Retry to verify this session.');
    if(e.blocks.some((a,i)=>e.blocks.some((b,j)=>j<i&&a[0]<b[1]&&b[0]<a[1]))||e.removedBlocks.some((a,i)=>!e.blocks.some(b=>equal(a,b))||e.removedBlocks.some((b,j)=>j<i&&equal(a,b))))throw Error('Editing controls unavailable. Retry to verify this session.');
    return r;
  }
  function draw(){
    const current=!!S&&isCur()&&S.revision===receipt?.revision;
    status.textContent=message||(!current?'Select the current version to edit whole blocks.':receipt.editing.blocks.length?'Only the listed whole blocks can be cut or restored.':'No eligible whole blocks are available for editing.');
    retry.hidden=!uncertain;retry.disabled=busy||refreshing;
    list.replaceChildren();
    if(receipt&&!uncertain)receipt.editing.blocks.forEach((range,i)=>{
      const removed=receipt.editing.removedBlocks.some(a=>equal(a,range)),button=document.createElement('button');
      button.type='button';button.textContent=(removed?'Restore':'Cut')+' block '+(i+1)+' ('+fmtx(range[0])+'–'+fmtx(range[1])+')';
      button.disabled=busy||refreshing||!!S?.busy||!current;
      button.onclick=()=>submit(removed?'restore':'cut',range);list.append(button);
    });
    notify();
  }
  async function refresh(force){
    if(refreshing||busy)return;refreshing=true;draw();
    try{
      if(!uuid.test(request||''))throw Error('Editing session is invalid.');
      const response=await fetch(new URL('../find?request='+request,location.href));
      if(!response.ok)throw Error('Editing session unavailable or expired. Retry to verify.');
      const next=validate(await response.json());
      await nativeLoad(force);
      if(!S||S.revision!==next.revision)throw Error('The video revision changed. Retry to verify.');
      receipt=next;uncertain=false;stopped=false;if(message==='Loading editing controls…')message='';
    }catch(e){uncertain=true;stopped=true;message=e.message||'Editing controls unavailable. Retry to verify.'}
    finally{refreshing=false;draw()}
  }
  async function submit(operation,range){
    if(busy||refreshing||uncertain||!receipt||!S||S.busy||!isCur()||S.revision!==receipt.revision)return;
    busy=true;message='Saving whole-block edit…';draw();
    try{
      const response=await fetch('./edits',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision:receipt.revision,[operation]:[range]})});
      if(!response.ok)throw Error(response.status===409?'This revision changed. Review the refreshed version before editing.':response.status===422?'This block edit was rejected. Review the verified preview before editing.':'The edit could not be confirmed. Review the verified preview before editing.');
      const result=await response.json();
      if(result.event!==true||!Number.isSafeInteger(result.revision)||result.revision!==receipt.revision+1)throw Error('The edit could not be confirmed. Retry to verify.');
      message='Whole-block edit saved.';
    }catch(e){message=e.message||'The edit could not be confirmed. Retry to verify.'}
    finally{busy=false;await refresh(true);draw()}
  }
  retry.onclick=()=>{message='';refresh(true)};
  // Polling stays suspended after an uncertain receipt until an explicit retry.
  load=()=>stopped?Promise.resolve():refresh(false);
  document.addEventListener('click',()=>queueMicrotask(draw));
  document.addEventListener('keydown',e=>{if(e.target.closest?.('button')&&[' ','Enter'].includes(e.key)){e.stopImmediatePropagation();return}if(['c','i','o','z','?'].includes(e.key.toLowerCase())&&!/INPUT|TEXTAREA|SELECT/.test(e.target.tagName)){e.preventDefault();e.stopImmediatePropagation()}},true);
  if(typeof ResizeObserver!=='undefined')new ResizeObserver(notify).observe(document.body);
  window.addEventListener('resize',notify);refresh(true);setInterval(()=>load(),3000);
  })()</script>`;
  return html.replace('</head>', css + '</head>').replace('</body>', controls + '</body>');
}
