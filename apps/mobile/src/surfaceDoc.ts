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
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:";

function bridge(nonce: string): string {
  return `(function(){
var N=${JSON.stringify(nonce)};
function post(m){m.apx=N;window.ReactNativeWebView&&window.ReactNativeWebView.postMessage(JSON.stringify(m));}
var touched=0;
addEventListener("touchend",function(){touched=Date.now();},true);
addEventListener("click",function(){touched=Date.now();},true);
function sendPrompt(t){post({kind:"prompt",text:String(t),gesture:Date.now()-touched<1500});}
window.apx=Object.freeze({sendPrompt:sendPrompt});
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
<script>${bridge(opts.nonce)}</script>`;
  return injectSurfaceHead(html, head);
}

/** A message from the page, if it is this page's (its nonce) and well formed; a prompt only after a real touch. */
export function readSurfaceMessage(raw: string, nonce: string): { prompt: string } | undefined {
  let m: { apx?: unknown; kind?: unknown; text?: unknown; gesture?: unknown };
  try {
    m = JSON.parse(raw) as typeof m;
  } catch {
    return undefined;
  }
  if (!m || m.apx !== nonce || m.kind !== "prompt" || m.gesture !== true) return undefined;
  const text = typeof m.text === "string" ? m.text.trim().slice(0, 4000) : "";
  return text ? { prompt: text } : undefined;
}
