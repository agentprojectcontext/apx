// A surface's HTML as the phone shows it: the panel's strict CSP (inline code only, no network), the phone's light or
// dark colors, and a window.apx bridge that speaks to the app through ReactNativeWebView. Pure: tested under node:test.

/** Widgets are self-contained (the show_widget contract): inline code only, no network. */
export const SURFACE_CSP =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:";

/** The few --apx-* tokens widgets use, as the design system's minimal look sets them (packages/ui tokens.css). */
const TOKENS = {
  light:
    "--apx-bg:#faf9f7;--apx-surface:#ffffff;--apx-fill:#efeeea;--apx-fg:#161616;--apx-fg-muted:#5f5e5a;--apx-border:#e7e5e0;--apx-brand:#1a9460;--apx-danger:#d23c3c;--apx-font-sans:system-ui,-apple-system,sans-serif;--apx-font-mono:ui-monospace,Menlo,monospace;",
  dark: "--apx-bg:#161615;--apx-surface:#1e1e1d;--apx-fill:#272726;--apx-fg:#ededeb;--apx-fg-muted:#a6a59f;--apx-border:#2c2c2a;--apx-brand:#3ec98b;--apx-danger:#f06464;--apx-font-sans:system-ui,-apple-system,sans-serif;--apx-font-mono:ui-monospace,Menlo,monospace;",
} as const;

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

export function surfaceDoc(html: string, opts: { mode: "light" | "dark"; nonce: string }): string {
  const head = `<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${SURFACE_CSP}">
<style>:root{${TOKENS[opts.mode]}}
html{color-scheme:${opts.mode}}
html,body{margin:0;background:var(--apx-bg);color:var(--apx-fg);font-family:var(--apx-font-sans);font-size:15px;line-height:1.45}
body{padding:12px}*{box-sizing:border-box}</style>
<script>${bridge(opts.nonce)}</script>`;
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, (m) => `${m}${head}`);
  if (/<html[^>]*>/i.test(html)) return html.replace(/<html[^>]*>/i, (m) => `${m}<head>${head}</head>`);
  return `<!doctype html><html><head>${head}</head><body>${html}</body></html>`;
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
