import assert from "node:assert/strict";
import { test } from "node:test";
import type { PageCdp } from "./page-check.ts";
import { createWidgetPages, editDocument } from "./widget-pages.ts";

type Message = { method?: string; params?: unknown };

/** A browser over fake CDP: records commands and lets a test speak as the page's binding. */
function fakeBrowser(height: unknown) {
  const sent: Array<{ method: string; params: Record<string, unknown>; session?: string }> = [];
  const listeners = new Map<string, (m: Message) => void>();
  let targets = 0;
  const cdp: PageCdp = {
    send: (async (method: string, params: Record<string, unknown> = {}, session?: string) => {
      sent.push({ method, params, session });
      if (method === "Target.createBrowserContext") return { browserContextId: "ctx" };
      if (method === "Target.createTarget") return { targetId: `t${++targets}` };
      if (method === "Target.attachToTarget") return { sessionId: `s${targets}` };
      if (method === "Page.getFrameTree") return { frameTree: { frame: { id: "f" } } };
      if (method === "Runtime.evaluate" && String(params.expression).includes("scrollHeight"))
        return { result: { value: height } };
      return {};
    }) as PageCdp["send"],
    listen: (session, fn) => {
      listeners.set(session, fn);
      return () => listeners.delete(session);
    },
  };
  return { cdp, sent, page: (session: string, m: Message) => listeners.get(session)?.(m) };
}

test("a widget's edit page is cut off from the network before its code loads, and sized to what it shows", async () => {
  const b = fakeBrowser(5000);
  const pages = createWidgetPages(async () => b.cdp, { sleep: async () => {} });
  const id = await pages.open("<p>Hi</p>", 480, async () => undefined);
  assert.equal(id, "w1");
  const order = b.sent.map((s) => s.method);
  assert.ok(order.indexOf("Network.setBlockedURLs") < order.indexOf("Page.setDocumentContent"));
  assert.deepEqual(b.sent.find((s) => s.method === "Network.setBlockedURLs")?.params, { urls: ["*"] });
  // An own browser context: no cookie or login of anyone else's is in it.
  assert.ok(order.includes("Target.createBrowserContext"));
  const sizes = b.sent.filter((s) => s.method === "Emulation.setDeviceMetricsOverride").map((s) => s.params.height);
  assert.deepEqual(sizes, [800, 2400]);
  await pages.close(id);
  assert.ok(b.sent.some((s) => s.method === "Target.disposeBrowserContext"));
  await assert.rejects(pages.inspect(id, 0.5, 0.5), /open edit mode again/);
});

test("the page's calls reach only the reads it is given; garbage is ignored", async () => {
  const b = fakeBrowser("not a number");
  const asked: string[] = [];
  const pages = createWidgetPages(async () => b.cdp, { sleep: async () => {} });
  await pages.open("<p>Hi</p>", 480, async (method) => {
    asked.push(method);
    return method === "store_get" ? { values: { n: 1 } } : undefined;
  });
  const call = (payload: string) =>
    b.page("s1", { method: "Runtime.bindingCalled", params: { name: "__apxCheck", payload } });
  call("{not json");
  call(JSON.stringify({ id: "x", method: "store_get" }));
  call(JSON.stringify({ id: 1, method: "store_get", params: {} }));
  call(JSON.stringify({ id: 2, method: "store_set", params: { patch: { n: 2 } } }));
  b.page("s1", { method: "Runtime.bindingCalled", params: { name: "other", payload: "{}" } });
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(asked, ["store_get", "store_set"]);
  const answers = b.sent.filter((s) => String(s.params.expression ?? "").startsWith("window.__apxResult"));
  assert.deepEqual(
    answers.map((a) => a.params.expression),
    ['window.__apxResult(1,true,{"values":{"n":1}})'],
  );
  // A height it does not report reads as the default.
  assert.equal(b.sent.filter((s) => s.method === "Emulation.setDeviceMetricsOverride").at(-1)?.params.height, 800);
});

test("the edit document keeps the CSP, the theme without markup and the bridge before the widget's code", () => {
  const doc = editDocument("<html><head><script>start()</script></head><body>x</body></html>", {
    theme: ":root{--apx-bg:#fff}</style><script>bad()</script>",
    mode: "dark",
    layout: "widget",
  });
  assert.match(doc, /Content-Security-Policy" content="default-src 'none'/);
  assert.doesNotMatch(doc, /<script>bad\(\)/);
  assert.ok(doc.indexOf("window.apx=") < doc.indexOf("start()"));
  assert.match(doc, /data-ax-mode","dark"/);
});
