// The Chrome host against a Chrome that answers like APX's extension: only the APX group, every load guarded, and the
// owner's Cancel respected. The real extension and Chromium are exercised in apps/chrome-extension/control.test.ts.
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { test } from "node:test";
import { CHROME_EXTENSION_ORIGIN, type ChromeRequest } from "@apx/protocol";
import type { ApxClient, ApxSocket } from "@apx/protocol/client";
import { runChromeHost } from "./host.ts";
import { createChromeTabs } from "./tabs.ts";
import { ExtensionLink, encodeFrame, frameReader, MAX_IN } from "./wire.ts";

type FakeTab = { url: string; title: string; group: boolean };

/** Chrome with APX's extension: tabs (some in the APX group) and the commands the host sent them. */
function fakeChrome(start: Record<number, FakeTab> = {}) {
  const tabs = new Map(Object.entries(start).map(([id, t]) => [Number(id), t]));
  const sent: ChromeRequest[] = [];
  let next = 100;
  const link: ExtensionLink = new ExtensionLink((frame) => {
    const m = frame as ChromeRequest;
    sent.push(m);
    const ok = (result: unknown) => queueMicrotask(() => link.receive({ t: "res", id: m.id, ok: true, result }));
    const fail = (error: string) => queueMicrotask(() => link.receive({ t: "res", id: m.id, ok: false, error }));
    if (m.t === "list")
      return ok([...tabs].filter(([, t]) => t.group).map(([tab, t]) => ({ tab, url: t.url, title: t.title })));
    if (m.t === "open") {
      const tab = next++;
      tabs.set(tab, { url: "about:blank", title: "", group: true });
      return ok({ tab });
    }
    const t = tabs.get(m.tab);
    if (!t?.group) return fail("that tab is not in Chrome's APX group");
    if (m.t === "close") {
      tabs.delete(m.tab);
      return ok(null);
    }
    if (m.t === "show") return ok(null);
    if (m.method === "Page.navigate") {
      const url = String(m.params?.url);
      t.url = url;
      t.title = `Page at ${new URL(url).pathname}`;
      ok({ frameId: "f1" });
      queueMicrotask(() => {
        link.receive({ t: "event", tab: m.tab, method: "Page.frameNavigated", params: { frame: { url } } });
        link.receive({ t: "event", tab: m.tab, method: "Page.loadEventFired", params: {} });
      });
      return;
    }
    if (m.method === "Page.getNavigationHistory")
      return ok({ currentIndex: 0, entries: [{ id: 1, url: t.url, title: t.title }] });
    return ok({});
  });
  return { link, tabs, sent, cdp: () => sent.flatMap((m) => (m.t === "cdp" ? [m.method] : [])) };
}

const driver = (chrome: ReturnType<typeof fakeChrome>) =>
  createChromeTabs({ link: chrome.link, blockedPorts: new Set(["7440"]), selectAllModifiers: 4 });

test("the agent sees only the APX group's tabs, and a tab the owner moves in", async () => {
  const chrome = fakeChrome({
    1: { url: "https://mail.example/inbox", title: "Inbox", group: false },
    2: { url: "https://northwind.example/orders", title: "Orders", group: true },
  });
  const tabs = driver(chrome);
  const listed = (await tabs.handle("browser.tabs", {})) as { tabs: Array<{ tab: string; profile: string }> };
  assert.deepEqual(
    listed.tabs.map((t) => [t.tab, t.profile]),
    [["c2", "shared"]],
  );
  const moved = chrome.tabs.get(1);
  if (moved) moved.group = true;
  chrome.link.receive({ t: "tabs" });
  const again = (await tabs.handle("browser.tabs", {})) as { tabs: Array<{ tab: string }> };
  assert.deepEqual(again.tabs.map((t) => t.tab).sort(), ["c1", "c2"]);
  await assert.rejects(tabs.handle("browser.snapshot", { tab: "c9", max_chars: 1000 }), /no tab c9/);
});

test("a new tab opens in the group, guarded, and loads its page", async () => {
  const chrome = fakeChrome();
  const tabs = driver(chrome);
  await assert.rejects(
    tabs.handle("browser.open", { url: "http://127.0.0.1:7440/", profile: "shared", by: "roby" }),
    /that is APX itself/,
  );
  assert.equal(chrome.sent.length, 0, "nothing opens for an address that is refused");
  const opened = (await tabs.handle("browser.open", {
    url: "https://northwind.example/orders",
    profile: "shared",
    by: "roby",
  })) as { tab: string; url: string; title: string; control: { kind: string; by?: string } };
  assert.equal(opened.tab, "c100");
  assert.equal(opened.url, "https://northwind.example/orders");
  assert.equal(opened.title, "Page at /orders");
  assert.deepEqual(opened.control.kind === "agent" && opened.control.by, "roby");
  assert.deepEqual(chrome.cdp().slice(0, 5), [
    "Page.enable",
    "DOM.enable",
    "Accessibility.enable",
    "Fetch.enable",
    "Page.navigate",
  ]);
  await assert.rejects(
    tabs.handle("browser.open", { url: "https://northwind.example/", profile: "agent:scout", by: "scout" }),
    /profile of its own/,
  );
});

test("every document load in a driven tab passes the same guard", async () => {
  const chrome = fakeChrome({ 5: { url: "https://northwind.example/", title: "Northwind", group: true } });
  driver(chrome);
  for (const [url, expected] of [
    ["http://127.0.0.1:7440/?quick", "Fetch.failRequest"],
    ["http://169.254.169.254/latest", "Fetch.failRequest"],
    ["https://northwind.example/next", "Fetch.continueRequest"],
  ] as const) {
    chrome.sent.length = 0;
    chrome.link.receive({
      t: "event",
      tab: 5,
      method: "Fetch.requestPaused",
      params: { requestId: "r1", request: { url } },
    });
    await new Promise((r) => setImmediate(r));
    assert.deepEqual(chrome.cdp(), [expected], url);
  }
});

test("when the owner presses Cancel on Chrome's bar, APX stays out of that tab until handed back", async () => {
  const chrome = fakeChrome({ 7: { url: "https://northwind.example/", title: "Northwind", group: true } });
  const tabs = driver(chrome);
  await tabs.handle("browser.tabs", {});
  chrome.link.receive({ t: "detached", tab: 7, reason: "canceled_by_user" });
  await assert.rejects(
    tabs.handle("browser.navigate", { tab: "c7", url: "https://northwind.example/a", by: "roby" }),
    /the owner stopped APX in tab c7/,
  );
  await assert.rejects(tabs.handle("browser.snapshot", { tab: "c7", max_chars: 1000 }), /the owner stopped APX/);
  await tabs.handle("browser.control", { tab: "c7", mode: "idle" });
  const r = (await tabs.handle("browser.navigate", { tab: "c7", url: "https://northwind.example/a", by: "roby" })) as {
    url: string;
  };
  assert.equal(r.url, "https://northwind.example/a");
});

test("a tab showing APX itself is never read or driven, however it got into the group", async () => {
  const chrome = fakeChrome({ 8: { url: "http://127.0.0.1:7440/?quick", title: "APX", group: true } });
  const tabs = driver(chrome);
  await assert.rejects(tabs.handle("browser.snapshot", { tab: "c8", max_chars: 1000 }), /shows APX itself/);
  await assert.rejects(tabs.handle("browser.click", { tab: "c8", ref: "e1", by: "roby" }), /shows APX itself/);
  const listed = (await tabs.handle("browser.tabs", {})) as { tabs: Array<{ control: { kind: string } }> };
  assert.equal(listed.tabs[0]?.control.kind, "idle", "a refused tab is not marked as the agent's");
});

test("what needs APX's own browser is refused with a reason", async () => {
  const chrome = fakeChrome({ 3: { url: "https://northwind.example/", title: "Northwind", group: true } });
  const tabs = driver(chrome);
  await assert.rejects(
    tabs.handle("browser.evaluate", {
      tab: "c3",
      script: "1",
      origin: "https://northwind.example",
      document: "d",
      by: "roby",
    }),
    /only in APX's own browser/,
  );
  await assert.rejects(tabs.handle("browser.handoff", { tab: "c3", reason: "sign in", by: "roby" }), /ask them/);
  await assert.rejects(tabs.handle("browser.import_cookies", { source: "chrome", domains: ["a.example"] }), /logins/);
});

test("native frames survive any chunking, and a size Chrome never sends ends the stream", () => {
  const got: unknown[] = [];
  const read = frameReader((m) => got.push(m));
  const bytes = Buffer.concat([encodeFrame({ t: "tabs" }), encodeFrame({ a: "é".repeat(50) })]);
  for (const byte of bytes) read(Buffer.from([byte]));
  assert.deepEqual(got, [{ t: "tabs" }, { a: "é".repeat(50) }]);
  const huge = Buffer.alloc(4);
  huge.writeUInt32LE(MAX_IN + 1);
  assert.throws(() => read(huge), /invalid native message size/);
  assert.throws(() => encodeFrame({ big: "x".repeat(1024 * 1024) }), /too large/);
});

test("the host serves only APX's extension, lends the group as a node, and ends with Chrome", async () => {
  const io = { input: new PassThrough(), write: (_: Buffer) => {} };
  const client = { connect: async () => assert.fail("never connects") } as unknown as ApxClient;
  await assert.rejects(
    runChromeHost({ origin: "chrome-extension://abcdefghijklmnopabcdefghijklmnop/", io, client, corePort: "7440" }),
    /only APX's Chrome extension/,
  );

  let serve: ((method: string, params: unknown) => unknown) | undefined;
  let caps: string[] = [];
  let closeSocket = () => {};
  const socket = {
    onRequest: (fn: typeof serve) => {
      serve = fn;
    },
    closed: new Promise<void>((resolve) => {
      closeSocket = resolve;
    }),
    close: () => closeSocket(),
  } as unknown as ApxSocket;
  const fake = {
    connect: async (_role: string, c: string[]) => {
      caps = c;
      return socket;
    },
  } as unknown as ApxClient;
  const input = new PassThrough();
  // Chrome's side: answers the host's list request with one grouped tab.
  const answer = frameReader((m) => {
    const req = m as ChromeRequest;
    if (req.t === "list")
      input.write(
        encodeFrame({
          t: "res",
          id: req.id,
          ok: true,
          result: [{ tab: 4, url: "https://northwind.example/", title: "Northwind" }],
        }),
      );
  });
  const running = runChromeHost({
    origin: CHROME_EXTENSION_ORIGIN,
    io: { input, write: (frame) => answer(frame) },
    client: fake,
    corePort: "7440",
  });
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(caps, ["chrome"]);
  const listed = (await serve?.("browser.tabs", {})) as { tabs: Array<{ tab: string }> };
  assert.deepEqual(
    listed.tabs.map((t) => t.tab),
    ["c4"],
  );
  input.end();
  await running;
});
