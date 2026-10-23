import type { SurfaceState } from "@apx/protocol";
import {
  injectSurfaceHead,
  type SurfaceLayout,
  surfaceLayoutCss,
  WIDGET_KIT_CSS,
} from "../../../../packages/surfaces/src/widget-kit.ts";

// Builds the iframe document for a surface: theme tokens, a strict CSP and the window.apx bridge.

/**
 * Widgets are self-contained (show_widget contract): inline code only, and no network but the origins they declared
 * for live data (checked again here: a bare https/wss origin, nothing that could add a directive). A project's media
 * reaches them as bytes the host hands over (data-apx-src, apx.media), loaded from the frame's own blob: URLs.
 */
const ORIGIN = /^(https|wss):\/\/[a-z0-9.-]+(:\d{1,5})?$/;
const csp = (connect: readonly string[] = []) => {
  const origins = connect.filter((o) => ORIGIN.test(o));
  return `default-src 'none'; form-action 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:${origins.length ? `; connect-src ${origins.join(" ")}` : ""}`;
};

let tokenNames: string[] | undefined;

/** Every --apx-* custom property declared in the page's stylesheets (read once). */
function apxTokenNames(): string[] {
  if (tokenNames) return tokenNames;
  const names = new Set<string>();
  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      continue;
    }
    for (const rule of Array.from(rules)) {
      if (!(rule instanceof CSSStyleRule)) continue;
      for (let i = 0; i < rule.style.length; i++) {
        const n = rule.style.item(i);
        if (n.startsWith("--apx-")) names.add(n);
      }
    }
  }
  tokenNames = [...names];
  return tokenNames;
}

/** Current token values as a `:root{…}` block, resolved on `el` (inside the ApxProvider). */
export function themeCss(el: Element): string {
  const cs = getComputedStyle(el);
  const decls = apxTokenNames()
    .map((n) => [n, cs.getPropertyValue(n).trim()] as const)
    .filter(([, v]) => v && !/[<>]/.test(v))
    .map(([n, v]) => `${n}:${v};`)
    .join("");
  return `:root{${decls}}`;
}

/** JSON safe inside an inline <script>: no "</script" or "<!--" can end or bend it. */
const scriptJson = (v: unknown) => JSON.stringify(v).replace(/</g, "\\u003c");

function bridge(nonce: string, mode: "light" | "dark", initial: SurfaceState): string {
  return `(function(){
var N=${JSON.stringify(nonce)};
document.documentElement.setAttribute("data-ax-mode",${JSON.stringify(mode)});
function post(m){m.apx=N;parent.postMessage(m,"*");}
var ST=${scriptJson(initial)},subs=[],pend=null,timer=0;
function copy(v){return v===undefined?v:JSON.parse(JSON.stringify(v));}
function emit(src){var s=copy(ST);subs.slice().forEach(function(f){try{f(s,src);}catch(err){console.error(err);}});}
function flush(){if(timer){clearTimeout(timer);timer=0;}if(!pend)return;post({kind:"state",patch:pend});pend=null;}
function patch(p){if(!p||typeof p!=="object")return;Object.keys(p).forEach(function(k){var v=p[k];if(v===null||v===undefined){delete ST[k];v=null;}else{v=copy(v);ST[k]=v;}(pend=pend||{})[k]=v;});
if(!timer)timer=setTimeout(flush,300);emit("local");}
function one(k,v){var o={};o[k]=v===undefined?null:v;patch(o);}
var state=Object.freeze({persistent:true,patch:patch,all:function(){return copy(ST);},get:function(k,d){return k in ST?copy(ST[k]):d;},
set:one,remove:function(k){one(k,null);},on:function(f){subs.push(f);return function(){subs=subs.filter(function(x){return x!==f;});};}});
addEventListener("pagehide",flush);
function sendPrompt(t){var a=navigator.userActivation;post({kind:"prompt",text:String(t),gesture:!!(a&&a.isActive)});}
var seq=0,wait={},urls={},calls={},shown=true,shownSubs=[];
function call(method,params){return new Promise(function(ok,no){var id=++seq;calls[id]={ok:ok,no:no};
try{post({kind:"call",id:id,method:String(method),params:params&&typeof params==="object"?params:{}});}catch(err){delete calls[id];no(err);}});}
function onVisibility(f){shownSubs.push(f);return function(){shownSubs=shownSubs.filter(function(x){return x!==f;});};}
function media(ref){ref=String(ref);if(!urls[ref])urls[ref]=new Promise(function(ok,no){var id=++seq;wait[id]={ok:ok,no:no};post({kind:"media",id:id,ref:ref});});return urls[ref];}
addEventListener("message",function(e){var m=e.data;if(e.source!==parent||!m||m.apx!==N)return;
if(m.kind==="state"&&m.state&&typeof m.state==="object"){var next=copy(m.state);if(pend)Object.keys(pend).forEach(function(k){if(pend[k]===null)delete next[k];else next[k]=pend[k];});
if(JSON.stringify(next)!==JSON.stringify(ST)){ST=next;emit("remote");}return;}
if(m.kind==="result"){var c=calls[m.id];if(!c)return;delete calls[m.id];if(m.ok)c.ok(m.value);else c.no(new Error(String(m.error||"call failed")));return;}
if(m.kind==="visibility"){var v=m.visible!==false;if(v!==shown){shown=v;shownSubs.slice().forEach(function(f){try{f(v);}catch(err){console.error(err);}});}return;}
if(m.kind!=="media")return;var w=wait[m.id];if(!w)return;delete wait[m.id];
if(m.data instanceof ArrayBuffer)w.ok(URL.createObjectURL(new Blob([m.data],{type:String(m.mime)})));else w.no(new Error(String(m.error||"media unavailable")));});
function attach(el,attr,prop){var ref=el.getAttribute(attr);if(!ref||el["__apx"+prop]===ref)return;el["__apx"+prop]=ref;
media(ref).then(function(u){el.setAttribute(prop,u);var p=el.parentElement;if(el.tagName==="SOURCE"&&p&&p.load)p.load();},function(){el.setAttribute("data-apx-error","");});}
function scan(root){if(!root.querySelectorAll)return;[["data-apx-src","src"],["data-apx-poster","poster"]].forEach(function(a){
if(root.hasAttribute&&root.hasAttribute(a[0]))attach(root,a[0],a[1]);root.querySelectorAll("["+a[0]+"]").forEach(function(el){attach(el,a[0],a[1]);});});}
window.apx=Object.freeze({host:"apx",sendPrompt:sendPrompt,media:media,state:state,call:call,visible:function(){return shown;},onVisibility:onVisibility});
window.sendPrompt=sendPrompt;
document.addEventListener("DOMContentLoaded",function(){scan(document);new MutationObserver(function(rs){rs.forEach(function(r){
if(r.type==="attributes")scan(r.target);else r.addedNodes.forEach(scan);});}).observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:["data-apx-src","data-apx-poster"]});});
var last=0;
function size(){var b=document.body;if(!b)return;var h=Math.ceil(b.scrollHeight);if(h!==last){last=h;post({kind:"height",height:h});}}
addEventListener("load",size);
document.addEventListener("DOMContentLoaded",function(){size();if(window.ResizeObserver)new ResizeObserver(size).observe(document.body);});
})();`;
}

/** What a page may ask the core through the bridge (APX.store, APX.db, APX.fetch), by the name it uses. */
export const BRIDGE_METHODS = {
  store_get: "surfaces.store_get",
  store_set: "surfaces.store_set",
  db_query: "surfaces.db_query",
  db_exec: "surfaces.db_exec",
  fetch: "surfaces.fetch",
} as const;
export type BridgeMethod = (typeof BRIDGE_METHODS)[keyof typeof BRIDGE_METHODS];

/**
 * A page's `call` message as the RPC the host makes, or undefined when it may not: only the allowed methods, with
 * object params, and always on the frame's own surface (whatever id the page put in).
 */
export function bridgeCall(
  method: unknown,
  params: unknown,
  surface: string,
): { method: BridgeMethod; params: Record<string, unknown> } | undefined {
  if (typeof method !== "string" || !Object.hasOwn(BRIDGE_METHODS, method)) return undefined;
  if (typeof params !== "object" || params === null || Array.isArray(params)) return undefined;
  return { method: BRIDGE_METHODS[method as keyof typeof BRIDGE_METHODS], params: { ...params, surface } };
}

export function buildSrcdoc(
  html: string,
  opts: {
    layout?: SurfaceLayout;
    theme: string;
    mode: "light" | "dark";
    nonce: string;
    connect?: readonly string[] | undefined;
    /** What the widget remembered when the frame was built; later changes arrive as messages. */
    state?: SurfaceState | undefined;
  },
): string {
  const head = `<meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp(opts.connect)}">
<style>${opts.theme}
html{color-scheme:${opts.mode}}
html,body{margin:0;background:transparent;color:var(--apx-fg);font-family:var(--apx-font-sans);font-size:14px;line-height:1.45}
body{padding:0;display:flow-root}*{box-sizing:border-box}
${WIDGET_KIT_CSS}
${surfaceLayoutCss(opts.layout)}</style>
<script>${bridge(opts.nonce, opts.mode, opts.state ?? {})}</script>`;
  // A stylesheet or font from the web never loads here (the CSP), and a blocked one can hold the page unpainted.
  html = html.replace(/<link\b[^>]*\bhref\s*=\s*["']?(?:https?:)?\/\/[^>]*>/gi, "");
  return injectSurfaceHead(html, head);
}
