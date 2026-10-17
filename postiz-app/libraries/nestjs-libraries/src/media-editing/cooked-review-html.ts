/** Small pinned-UI adapter. Authorization remains on every gateway route. */
export function adaptCookedReviewHtml(html: string) {
  const edit = "fetch('/edits',{method:'POST',body:JSON.stringify(body)})";
  if (html.split(edit).length !== 2 || !html.includes('id="txlines"')) throw new Error('UNSUPPORTED_NATIVE_REVIEW');
  html = html.replace(edit, "fetch('/edits',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...body,revision:S.revision})})");
  // Relative URLs keep the browser's authenticated public reverse-proxy prefix.
  html = html.replace(/(['"])(\/(?:state|data|video|download|edits|frames|ask\.js|theme|event|back|update|intro|comment|edit|scope|delete|check|keep|undo|trials|assets)(?:[?\/][^'"\s]*)?)\1/g,
    (_, quote: string, path: string) => quote + '.' + path + quote);
  html = html.replace('<script src="./ask.js"></script>', '');
  // Keep the native transcript, playback, comparisons and history. Agent/capture/
  // learning controls are unavailable; their HTTP routes are also denied.
  const css = `<style>
  .rail,#stages,#statusbox,#mapprove,#intro,#how,#stagebar,#ask,#askbar,.ask,aside,
  #approve,#send,#safebtn,.themebtn,#oldbadge{display:none!important}
  .app{width:100%;margin:0!important}main,.left{min-width:0}header{min-height:36px}
  body.withTx #tx{display:flex!important}#txlines .tw{touch-action:none}
  @media(max-width:760px){body.withTx:not(.vertical) #stage,body.withTx #stage{height:auto;display:flex;flex-direction:column!important}
  body.withTx #pair{width:100%;min-height:180px;max-height:38vh;flex:none!important}
  body.withTx #tx{min-height:260px;height:40vh;flex:none!important;width:100%}
  body.withTx .pl,body.withTx:not(.vertical) .pl{max-width:100%;height:100%}
  #cmprow{display:flex!important}#rsztx{display:none!important}.left{padding-bottom:12px}}
  </style>`;
  return html.replace('</head>', css + '</head>');
}
