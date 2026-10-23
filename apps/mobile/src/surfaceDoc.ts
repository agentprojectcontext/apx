import {
  injectSurfaceHead,
  type SurfaceLayout,
  surfaceLayoutCss,
  WIDGET_KIT_CSS,
  WIDGET_TOKENS,
} from "../../../packages/surfaces/src/widget-kit.ts";

// A surface's HTML as the phone shows it: the panel's strict CSP (inline code only, no network), the phone's light or
// dark colors, and a window.apx bridge that speaks to the app through ReactNativeWebView. Pure: tested under node:test.

/** Widgets are self-contained (the show_widget contract): inline code only, no network. */
export const SURFACE_CSP =
  "default-src 'none'; form-action 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:";

function bridge(nonce: string, mode: "light" | "dark"): string {
  return `(function(){
var N=${JSON.stringify(nonce)};
document.documentElement.setAttribute("data-ax-mode",${JSON.stringify(mode)});
function post(m){m.apx=N;window.ReactNativeWebView&&window.ReactNativeWebView.postMessage(JSON.stringify(m));}
var touched=0;
addEventListener("touchend",function(){touched=Date.now();},true);
addEventListener("click",function(){touched=Date.now();},true);
function sendPrompt(t){post({kind:"prompt",text:String(t),gesture:Date.now()-touched<1500});}
var seq=0,calls={};
function call(method,params){return new Promise(function(ok,no){var id=++seq;calls[id]={ok:ok,no:no};
try{post({kind:"call",id:id,method:String(method),params:params&&typeof params==="object"?params:{}});}catch(err){delete calls[id];no(err);}});}
window.__apxResult=function(n,m){if(n!==N||!m)return;var c=calls[m.id];if(!c)return;delete calls[m.id];if(m.ok)c.ok(m.value);else c.no(new Error(String(m.error||"call failed")));};
window.apx=Object.freeze({host:"apx",sendPrompt:sendPrompt,call:call,visible:function(){return true;},onVisibility:function(){return function(){};}});
window.sendPrompt=sendPrompt;
})();`;
}

export function surfaceDoc(
  html: string,
  opts: { layout?: SurfaceLayout; mode: "light" | "dark"; nonce: string },
): string {
  const head = `<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${SURFACE_CSP}">
<style>:root{${WIDGET_TOKENS[opts.mode]}}
html{color-scheme:${opts.mode}}
html,body{margin:0;background:var(--apx-bg);color:var(--apx-fg);font-family:var(--apx-font-sans);font-size:15px;line-height:1.45}
body{padding:var(--apx-page-padding);display:flow-root}*{box-sizing:border-box}
${WIDGET_KIT_CSS}
${surfaceLayoutCss(opts.layout)}</style>
<script>${bridge(opts.nonce, opts.mode)}</script>`;
  return injectSurfaceHead(html, head);
}

/** What a page may ask the core from the phone: its own store and database (no fetch here). */
const PHONE_METHODS = {
  store_get: "surfaces.store_get",
  store_set: "surfaces.store_set",
  db_query: "surfaces.db_query",
  db_exec: "surfaces.db_exec",
} as const;
export type PhoneBridgeMethod = (typeof PHONE_METHODS)[keyof typeof PHONE_METHODS];
export type SurfaceCall = { id: number; method: PhoneBridgeMethod; params: Record<string, unknown> };

/**
 * A message from the page, if it is this page's (its nonce) and well formed: a prompt only after a real touch, a bridge
 * call only to an allowed method, always on `surface` (whatever id the page put in).
 */
export function readSurfaceMessage(
  raw: string,
  nonce: string,
  surface = "",
): { prompt: string } | { call: SurfaceCall } | { refused: number } | undefined {
  let m: {
    apx?: unknown;
    kind?: unknown;
    text?: unknown;
    gesture?: unknown;
    id?: unknown;
    method?: unknown;
    params?: unknown;
  };
  try {
    m = JSON.parse(raw) as typeof m;
  } catch {
    return undefined;
  }
  if (!m || m.apx !== nonce) return undefined;
  if (m.kind === "call" && typeof m.id === "number") {
    const p = m.params;
    if (typeof m.method !== "string" || !Object.hasOwn(PHONE_METHODS, m.method)) return { refused: m.id };
    if (typeof p !== "object" || p === null || Array.isArray(p)) return { refused: m.id };
    const method = PHONE_METHODS[m.method as keyof typeof PHONE_METHODS];
    return { call: { id: m.id, method, params: { ...p, surface } } };
  }
  if (m.kind !== "prompt" || m.gesture !== true) return undefined;
  const text = typeof m.text === "string" ? m.text.trim().slice(0, 4000) : "";
  return text ? { prompt: text } : undefined;
}

/** The script that hands a bridge call's answer back to the page (injected into the WebView). */
export function surfaceResult(
  nonce: string,
  r: { id: number } & ({ ok: true; value: unknown } | { ok: false; error: string }),
): string {
  const json = (v: unknown) => JSON.stringify(v).replace(/</g, "\\u003c");
  return `window.__apxResult&&window.__apxResult(${json(nonce)},${json(r)});true;`;
}
