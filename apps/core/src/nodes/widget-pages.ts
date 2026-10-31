// A widget in edit mode: the core's own browser runs it in a context of its own (no network, no logins, no cookies)
// so the owner can point at its parts. The page only gets answers to its reads; nothing it says is trusted: picking
// and edits go through CdpPage's DOM commands, as in a browser tab.
import type { ElementEdit, PickedElement } from "@apx/protocol";
import { CdpPage } from "@apx/protocol/cdp";
import { ApxError } from "@apx/protocol/client";
import { injectSurfaceHead, surfaceLayoutCss, WIDGET_KIT_CSS } from "../../../../packages/surfaces/src/widget-kit.ts";
import { type PageCall, type PageCdp, withBridge } from "./page-check.ts";

/** A page nobody looked at for this long closes; at most MAX_PAGES live at once (the oldest goes first). */
const IDLE_MS = 10 * 60_000;
const MAX_PAGES = 4;
/** How long the widget may run its start-up code before it is measured and shown. */
const SETTLE_MS = 900;
const MIN_HEIGHT = 240;
const MAX_HEIGHT = 2400;

const CSP =
  "default-src 'none'; form-action 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:";

/** The widget's page as the panel draws it (theme, kit, layout), with the read-only bridge the page check uses. */
export function editDocument(
  html: string,
  opts: { theme: string; mode: "light" | "dark"; layout: "widget" | "app" },
): string {
  const head = `<meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${CSP}">
<style>${opts.theme.replace(/[<>]/g, "")}
html{color-scheme:${opts.mode}}
html,body{margin:0;background:var(--apx-bg);color:var(--apx-fg);font-family:var(--apx-font-sans);font-size:14px;line-height:1.45}
body{padding:0;display:flow-root}*{box-sizing:border-box}
${WIDGET_KIT_CSS}
${surfaceLayoutCss(opts.layout)}</style>
<script>document.documentElement.setAttribute("data-ax-mode",${JSON.stringify(opts.mode)})</script>`;
  return withBridge(injectSurfaceHead(html, head));
}

type Page = {
  target: string;
  context: string;
  page: CdpPage;
  stop: () => void;
  used: number;
};

export function createWidgetPages(
  cdp: () => Promise<PageCdp>,
  opts: { now?: () => number; sleep?: (ms: number) => Promise<void> } = {},
) {
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const pages = new Map<string, Page>();
  let seq = 0;

  const get = (id: string): Page => {
    const p = pages.get(id);
    if (!p) throw new ApxError({ code: "not_found", message: "this widget's edit page closed: open edit mode again" });
    p.used = now();
    return p;
  };

  async function close(id: string): Promise<void> {
    const p = pages.get(id);
    if (!p) return;
    pages.delete(id);
    p.stop();
    const c = await cdp();
    await c.send("Target.closeTarget", { targetId: p.target }).catch(() => {});
    await c.send("Target.disposeBrowserContext", { browserContextId: p.context }).catch(() => {});
  }

  /** Runs the page at `width`, answering its reads with `onCall`; its height is what it shows, within bounds. */
  async function open(html: string, width: number, onCall: PageCall): Promise<string> {
    for (const [id, p] of pages) if (now() - p.used > IDLE_MS) await close(id);
    while (pages.size >= MAX_PAGES) {
      const oldest = [...pages.entries()].sort((a, b) => a[1].used - b[1].used)[0];
      if (!oldest) break;
      await close(oldest[0]);
    }
    const c = await cdp();
    const { browserContextId } = await c.send<{ browserContextId: string }>("Target.createBrowserContext", {
      disposeOnDetach: true,
    });
    const { targetId } = await c.send<{ targetId: string }>("Target.createTarget", {
      url: "about:blank",
      browserContextId,
    });
    const { sessionId } = await c.send<{ sessionId: string }>("Target.attachToTarget", { targetId, flatten: true });
    const send = <T>(method: string, params?: object) => c.send<T>(method, params ?? {}, sessionId);
    // A call that never resolves (a write, a fetch) simply gets no answer.
    const answer = (id: number, ok: boolean, value: unknown) => {
      if (value === undefined) return;
      const expression = `window.__apxResult(${id},${ok},${JSON.stringify(value)})`;
      void send("Runtime.evaluate", { expression }).catch(() => {});
    };
    const stop = c.listen(sessionId, (m) => {
      if (m.method !== "Runtime.bindingCalled") return;
      const p = m.params as { name: string; payload: string };
      if (p.name !== "__apxCheck") return;
      let req: { id: number; method: string; params: Record<string, unknown> };
      try {
        req = JSON.parse(p.payload);
      } catch {
        return;
      }
      if (typeof req?.id !== "number" || typeof req.method !== "string") return;
      void onCall(req.method, req.params ?? {}).then(
        (v) => answer(req.id, true, v),
        (e: unknown) => answer(req.id, false, e instanceof Error ? e.message : String(e)),
      );
    });
    const id = `w${++seq}`;
    pages.set(id, {
      target: targetId,
      context: browserContextId,
      page: new CdpPage(send, { selectAllModifiers: 0 }),
      stop,
      used: now(),
    });
    try {
      await send("Runtime.enable");
      await send("Page.enable");
      await send("DOM.enable");
      await send("Accessibility.enable");
      await send("Network.enable");
      await send("Network.setBlockedURLs", { urls: ["*"] });
      await send("Runtime.addBinding", { name: "__apxCheck" });
      const metrics = (height: number) =>
        send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
      await metrics(800);
      const { frameTree } = await send<{ frameTree: { frame: { id: string } } }>("Page.getFrameTree");
      await send("Page.setDocumentContent", { frameId: frameTree.frame.id, html });
      await sleep(SETTLE_MS);
      const measured = await send<{ result?: { value?: unknown } }>("Runtime.evaluate", {
        expression: "Math.ceil(document.body ? document.body.scrollHeight : 0)",
        returnByValue: true,
      }).catch(() => undefined);
      const h = Number(measured?.result?.value);
      await metrics(Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, Number.isFinite(h) ? h : 800)));
    } catch (e) {
      await close(id);
      throw e;
    }
    return id;
  }

  return {
    open,
    close,
    inspect: async (id: string, x: number, y: number): Promise<PickedElement | null> => get(id).page.inspect(x, y),
    preview: async (id: string, edits: readonly ElementEdit[]) => get(id).page.previewEdits(edits),
    shot: async (id: string) => get(id).page.screenshot(),
    /** Every page closed, as when the core stops. */
    async closeAll(): Promise<void> {
      for (const id of [...pages.keys()]) await close(id);
    },
    get size() {
      return pages.size;
    },
  };
}

export type WidgetPages = ReturnType<typeof createWidgetPages>;
