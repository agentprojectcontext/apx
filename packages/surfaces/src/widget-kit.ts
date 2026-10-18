/** Inline, dependency-free widget styles: shared by panel, phone and published pages without opening their CSP. */
export const WIDGET_KIT_CSS = `
.apx-widget{max-width:var(--apx-content-width,1100px);margin-inline:auto;min-width:0;font:14px/1.5 var(--apx-font-sans,system-ui,sans-serif);color:var(--apx-fg);overflow-wrap:anywhere}
.apx-widget *{box-sizing:border-box;min-width:0}
.apx-widget :where(h1,h2,h3,p){margin:0}
.apx-widget h1{font-size:clamp(22px,4vw,30px);line-height:1.2;letter-spacing:-.03em;font-weight:650}
.apx-widget h2{font-size:17px;line-height:1.35;font-weight:650}
.apx-widget h3{font-size:14px;font-weight:650}
.apx-stack{display:grid;gap:16px}
.apx-row{display:flex;flex-wrap:wrap;gap:12px;align-items:center;justify-content:space-between}
.apx-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,210px),1fr));gap:12px}
.apx-card{padding:20px;border:1px solid var(--apx-border);border-radius:14px;background:var(--apx-surface)}
.apx-muted{color:var(--apx-fg-muted)}
.apx-eyebrow{color:var(--apx-fg-muted);font-size:12px;font-weight:600;letter-spacing:.04em}
.apx-stat{font-size:32px;line-height:1.15;font-weight:650;letter-spacing:-.04em;font-variant-numeric:tabular-nums}
.apx-badge{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--apx-border);border-radius:999px;padding:3px 9px;font-size:12px;white-space:nowrap}
.apx-badge[data-tone="brand"]{color:var(--apx-brand);background:color-mix(in srgb,var(--apx-brand) 10%,transparent)}
.apx-toolbar{display:flex;flex-wrap:wrap;align-items:end;gap:12px}
.apx-field{display:grid;gap:6px;flex:1 1 160px;font-size:12px;color:var(--apx-fg-muted)}
.apx-widget :where(input,select,textarea,button){font:inherit;color:var(--apx-fg);border:1px solid var(--apx-border);border-radius:8px;background:var(--apx-surface);padding:9px 12px;min-height:40px;max-width:100%}
.apx-widget :where(input,select,textarea){width:100%}
.apx-widget :where(button){cursor:pointer;font-weight:600}
.apx-widget button[data-variant="primary"]{background:color-mix(in srgb,var(--apx-brand) 16%,var(--apx-surface));border-color:color-mix(in srgb,var(--apx-brand) 45%,var(--apx-border))}
.apx-widget button:hover:not(:disabled){background:var(--apx-fill,var(--apx-bg))}
.apx-widget button:disabled{opacity:.5;cursor:default}
.apx-widget :where(button,input,select,textarea,a):focus-visible{outline:2px solid var(--apx-brand);outline-offset:3px}
.apx-widget [hidden]{display:none}
.apx-widget a{color:var(--apx-brand);text-underline-offset:3px}
.apx-table-wrap{overflow-x:auto;border:1px solid var(--apx-border);border-radius:12px}
.apx-widget table{width:100%;border-collapse:collapse;text-align:left;background:var(--apx-surface)}
.apx-widget :where(th,td){padding:12px 16px;border-bottom:1px solid var(--apx-border);vertical-align:top}
.apx-widget th{font-size:12px;color:var(--apx-fg-muted);font-weight:600}
.apx-widget tr:last-child td{border-bottom:0}
@media(max-width:480px){.apx-card{padding:16px}.apx-toolbar{align-items:stretch}.apx-toolbar>button{width:100%}}
`;

/** Fallback colors for hosts without the panel's live theme tokens. */
export const WIDGET_TOKENS = {
  light:
    "--apx-bg:#faf9f7;--apx-surface:#ffffff;--apx-fill:#efeeea;--apx-fg:#161616;--apx-fg-muted:#5f5e5a;--apx-border:#e7e5e0;--apx-brand:#1a9460;--apx-danger:#d23c3c;--apx-font-sans:system-ui,-apple-system,sans-serif;--apx-font-mono:ui-monospace,Menlo,monospace;",
  dark: "--apx-bg:#161615;--apx-surface:#1e1e1d;--apx-fill:#272726;--apx-fg:#ededeb;--apx-fg-muted:#a6a59f;--apx-border:#2c2c2a;--apx-brand:#3ec98b;--apx-danger:#f06464;--apx-font-sans:system-ui,-apple-system,sans-serif;--apx-font-mono:ui-monospace,Menlo,monospace;",
} as const;

/** Inject before author styles so custom designs can override the kit. */
export function injectSurfaceHead(html: string, head: string): string {
  const prefix = /^(?:\s|<!--[\s\S]*?-->|<!doctype[^>]*>)*/i.exec(html)?.[0] ?? "";
  const opening = /^<html(?=[\s>])[^>]*>/i.exec(html.slice(prefix.length));
  if (opening) {
    const afterHtml = prefix.length + opening[0].length;
    const openingHead = /^(?:\s|<!--[\s\S]*?-->)*<head(?=[\s>])[^>]*>/i.exec(html.slice(afterHtml));
    const at = afterHtml + (openingHead?.[0].length ?? 0);
    const injected = openingHead ? head : `<head>${head}</head>`;
    return html.slice(0, at) + injected + html.slice(at);
  }
  return `<!doctype html><html><head>${head}</head><body>${html}</body></html>`;
}

export type SurfaceLayout = "widget" | "app";

/** Placement owns the outer inset; app content can occupy the entire viewport. */
export function surfaceLayoutCss(layout: SurfaceLayout = "widget"): string {
  return `:root{--apx-content-width:${layout === "app" ? "none" : "1100px"};--apx-page-padding:${layout === "app" ? "0px" : "clamp(16px,2vw,24px)"}}`;
}
