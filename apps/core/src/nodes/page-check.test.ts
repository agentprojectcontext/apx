import assert from "node:assert/strict";
import { test } from "node:test";
import { type PageCdp, runPageCheck, withBridge } from "./page-check.ts";

test("the bridge goes first in the page, before any of its own scripts", () => {
  const page = withBridge(`<html><head><script>own()</script></head></html>`);
  assert.ok(page.indexOf("window.apx=") < page.indexOf("own()"));
  assert.match(withBridge("<h1>fragment</h1>"), /^<script>.*<\/script><h1>/s);
});

/** A Chrome stand-in: replays the events a page would send once its document is set, and records what it was asked. */
function fakeCdp(events: Array<{ method: string; params: unknown }>) {
  const sent: Array<{ method: string; params: unknown }> = [];
  let listener: ((m: { method?: string; params?: unknown }) => void) | undefined;
  const cdp: PageCdp = {
    async send<T>(method: string, params?: object): Promise<T> {
      sent.push({ method, params });
      if (method === "Target.createBrowserContext") return { browserContextId: "ctx" } as T;
      if (method === "Target.createTarget") return { targetId: "tab" } as T;
      if (method === "Target.attachToTarget") return { sessionId: "s1" } as T;
      if (method === "Page.getFrameTree") return { frameTree: { frame: { id: "f1" } } } as T;
      if (method === "Page.setDocumentContent") for (const e of events) listener?.(e);
      if (method === "Runtime.evaluate" && String((params as { expression: string }).expression).includes("innerText"))
        return { result: { value: "Pantry 3 items" } } as T;
      return {} as T;
    },
    listen(_session, fn) {
      listener = fn;
      return () => {
        listener = undefined;
      };
    },
  };
  return { cdp, sent };
}

test("a check reports what the page threw, answers its bridge calls and closes its tab", async () => {
  const calls: string[] = [];
  const { cdp, sent } = fakeCdp([
    {
      method: "Runtime.exceptionThrown",
      params: { exceptionDetails: { exception: { description: "TypeError: x is null\n at y" }, lineNumber: 41 } },
    },
    { method: "Runtime.consoleAPICalled", params: { type: "error", args: [{ value: "load failed" }] } },
    { method: "Runtime.consoleAPICalled", params: { type: "log", args: [{ value: "fine" }] } },
    {
      method: "Runtime.bindingCalled",
      params: {
        name: "__apxCheck",
        payload: JSON.stringify({ id: 7, method: "db_query", params: { sql: "SELECT 1" } }),
      },
    },
  ]);
  const r = await runPageCheck(
    cdp,
    "<html><head></head><body></body></html>",
    async (method) => {
      calls.push(method);
      return { columns: ["1"], rows: [[1]] };
    },
    10,
  );
  assert.deepEqual(r.errors, ["TypeError: x is null (line 42)", "load failed"]);
  assert.equal(r.text, "Pantry 3 items");
  assert.deepEqual(calls, ["db_query"]);
  assert.ok(
    sent.some(
      (s) =>
        s.method === "Runtime.evaluate" &&
        String((s.params as { expression: string }).expression).includes("__apxResult(7,true"),
    ),
  );
  // No network, and the tab and its context are gone afterwards.
  assert.ok(sent.some((s) => s.method === "Network.setBlockedURLs"));
  assert.ok(sent.some((s) => s.method === "Target.closeTarget"));
  assert.ok(sent.some((s) => s.method === "Target.disposeBrowserContext"));
});
