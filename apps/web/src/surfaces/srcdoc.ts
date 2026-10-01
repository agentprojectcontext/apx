// Builds the iframe document for a surface: theme tokens, a strict CSP and the window.apx bridge.

/** Widgets are self-contained (show_widget contract): inline code only, no network. */
const CSP =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:";

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
window.apx=Object.freeze({sendPrompt:sendPrompt});
window.sendPrompt=sendPrompt;
var last=0;
function size(){var b=document.body;if(!b)return;var h=Math.ceil(b.scrollHeight);if(h!==last){last=h;post({kind:"height",height:h});}}
addEventListener("load",size);
document.addEventListener("DOMContentLoaded",function(){size();if(window.ResizeObserver)new ResizeObserver(size).observe(document.body);});
})();`;
}

export function buildSrcdoc(html: string, opts: { theme: string; mode: "light" | "dark"; nonce: string }): string {
  const head = `<meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${CSP}">
<style>${opts.theme}
html{color-scheme:${opts.mode}}
html,body{margin:0;background:transparent;color:var(--apx-fg);font-family:var(--apx-font-sans);font-size:14px;line-height:1.45}
body{padding:0}*{box-sizing:border-box}</style>
<script>${bridge(opts.nonce)}</script>`;
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, (m) => `${m}${head}`);
  if (/<html[^>]*>/i.test(html)) return html.replace(/<html[^>]*>/i, (m) => `${m}<head>${head}</head>`);
  return `<!doctype html><html><head>${head}</head><body>${html}</body></html>`;
}
