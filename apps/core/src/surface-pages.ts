// Read-only published HTML, shared by the private HTTP listener and restricted public ingress.
import {
  injectSurfaceHead,
  surfaceLayoutCss,
  WIDGET_KIT_CSS,
  WIDGET_TOKENS,
} from "../../../packages/surfaces/src/widget-kit.ts";
import type { HookResponse } from "./channels/types.ts";
import type { Store } from "./domain/store.ts";
import { kitSource, withKit } from "./surface-kit.ts";

export type PublicPages = {
  artifact(
    token: string,
  ): { title: string; html: string; app?: boolean | undefined; connect?: string[] | undefined } | undefined;
  kit?(): string;
};

export function storedPublicPages(store: Store): PublicPages {
  return {
    artifact: (token) => {
      const surface = store.surfaces.byShareToken(token);
      // Deliberately do not expose state, media, the artifact store, secrets, project data or provenance.
      return surface
        ? { title: surface.title, html: withKit(surface.html), app: surface.app, connect: surface.connect }
        : undefined;
    },
    kit: kitSource,
  };
}

function artifactPage(title: string, html: string, app = false): string {
  const esc = title.replace(/[<>&"]/g, (c) => `&#${c.charCodeAt(0)};`);
  return injectSurfaceHead(
    html,
    `<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc}</title>
<style>:root{${WIDGET_TOKENS.light};color-scheme:light}@media(prefers-color-scheme:dark){:root{${WIDGET_TOKENS.dark};color-scheme:dark}}
body{margin:0;padding:var(--apx-page-padding);background:var(--apx-bg);color:var(--apx-fg);font:14px/1.5 var(--apx-font-sans);display:flow-root}*{box-sizing:border-box}
${WIDGET_KIT_CSS}
${surfaceLayoutCss(app ? "app" : "widget")}</style>`,
  );
}

export function surfacePage(pathname: string, pages: PublicPages, restricted = false): HookResponse | undefined {
  const token = /^\/a\/([a-f0-9]{32})$/.exec(pathname)?.[1];
  if (token) {
    const page = pages.artifact(token);
    if (!page) return { status: 404 };
    const csp = restricted
      ? "sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:; font-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors *"
      : `sandbox allow-scripts allow-popups allow-forms; default-src 'self' data: blob: 'unsafe-inline'; form-action 'none'; connect-src ${page.connect?.length ? page.connect.join(" ") : "'none'"}; frame-ancestors *`;
    return {
      status: 200,
      body: artifactPage(page.title, page.html, page.app),
      headers: {
        "content-type": "text/html; charset=utf-8",
        "content-security-policy": csp,
        "cache-control": "no-store",
        "referrer-policy": "no-referrer",
        "x-content-type-options": "nosniff",
      },
    };
  }
  if (/^\/_apx\/kit@1(?:\.\d+){0,2}\.js$/.test(pathname) && pages.kit)
    return {
      status: 200,
      body: pages.kit(),
      headers: {
        "content-type": "text/javascript; charset=utf-8",
        "cache-control": "no-cache",
        "x-content-type-options": "nosniff",
      },
    };
  return;
}
