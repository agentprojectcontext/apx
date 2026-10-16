// Builds the iframe document for a surface: theme tokens, a strict CSP and the window.apx bridge.

/**
 * Widgets are self-contained (show_widget contract): inline code only, and no network but the origins they declared
 * for live data (checked again here: a bare https/wss origin, nothing that could add a directive). A project's media
 * reaches them as bytes the host hands over (data-apx-src, apx.media), loaded from the frame's own blob: URLs.
 */
const ORIGIN = /^(https|wss):\/\/[a-z0-9.-]+(:\d{1,5})?$/;
const csp = (connect: readonly string[] = []) => {
  const origins = connect.filter((o) => ORIGIN.test(o));
  return `default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:${origins.length ? `; connect-src ${origins.join(" ")}` : ""}`;
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

function bridge(nonce: string): string {
  return `(function(){
var N=${JSON.stringify(nonce)};
function post(m){m.apx=N;parent.postMessage(m,"*");}
function sendPrompt(t){var a=navigator.userActivation;post({kind:"prompt",text:String(t),gesture:!!(a&&a.isActive)});}
var seq=0,wait={},urls={};
function media(ref){ref=String(ref);if(!urls[ref])urls[ref]=new Promise(function(ok,no){var id=++seq;wait[id]={ok:ok,no:no};post({kind:"media",id:id,ref:ref});});return urls[ref];}
addEventListener("message",function(e){var m=e.data;if(e.source!==parent||!m||m.apx!==N||m.kind!=="media")return;var w=wait[m.id];if(!w)return;delete wait[m.id];
if(m.data instanceof ArrayBuffer)w.ok(URL.createObjectURL(new Blob([m.data],{type:String(m.mime)})));else w.no(new Error(String(m.error||"media unavailable")));});
function attach(el,attr,prop){var ref=el.getAttribute(attr);if(!ref||el["__apx"+prop]===ref)return;el["__apx"+prop]=ref;
media(ref).then(function(u){el.setAttribute(prop,u);var p=el.parentElement;if(el.tagName==="SOURCE"&&p&&p.load)p.load();},function(){el.setAttribute("data-apx-error","");});}
function scan(root){if(!root.querySelectorAll)return;[["data-apx-src","src"],["data-apx-poster","poster"]].forEach(function(a){
if(root.hasAttribute&&root.hasAttribute(a[0]))attach(root,a[0],a[1]);root.querySelectorAll("["+a[0]+"]").forEach(function(el){attach(el,a[0],a[1]);});});}
window.apx=Object.freeze({sendPrompt:sendPrompt,media:media});
window.sendPrompt=sendPrompt;
document.addEventListener("DOMContentLoaded",function(){scan(document);new MutationObserver(function(rs){rs.forEach(function(r){
if(r.type==="attributes")scan(r.target);else r.addedNodes.forEach(scan);});}).observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:["data-apx-src","data-apx-poster"]});});
var last=0;
function size(){var b=document.body;if(!b)return;var h=Math.ceil(b.scrollHeight);if(h!==last){last=h;post({kind:"height",height:h});}}
addEventListener("load",size);
document.addEventListener("DOMContentLoaded",function(){size();if(window.ResizeObserver)new ResizeObserver(size).observe(document.body);});
})();`;
}

export function buildSrcdoc(
  html: string,
  opts: { theme: string; mode: "light" | "dark"; nonce: string; connect?: readonly string[] | undefined },
): string {
  const head = `<meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp(opts.connect)}">
<style>${opts.theme}
html{color-scheme:${opts.mode}}
html,body{margin:0;background:transparent;color:var(--apx-fg);font-family:var(--apx-font-sans);font-size:14px;line-height:1.45}
body{padding:0;display:flow-root}*{box-sizing:border-box}</style>
<script>${bridge(opts.nonce)}</script>`;
  // A stylesheet or font from the web never loads here (the CSP), and a blocked one can hold the page unpainted.
  html = html.replace(/<link\b[^>]*\bhref\s*=\s*["']?(?:https?:)?\/\/[^>]*>/gi, "");
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, (m) => `${m}${head}`);
  if (/<html[^>]*>/i.test(html)) return html.replace(/<html[^>]*>/i, (m) => `${m}<head>${head}</head>`);
  return `<!doctype html><html><head>${head}</head><body>${html}</body></html>`;
}
