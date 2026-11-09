import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { registerHooks } from "node:module";
import { test } from "node:test";

class Contents extends EventEmitter {
  destroyed = false;
  url = "";
  debugger = Object.assign(new EventEmitter(), {
    attach() {},
    sendCommand: async () => ({}),
  });
  session = {
    clearStorageData: async () => {},
    clearCache: async () => {},
  };
  setWindowOpenHandler() {}
  isDestroyed() {
    return this.destroyed;
  }
  isLoading() {
    return false;
  }
  getURL() {
    assert.equal(this.destroyed, false, "cannot read a destroyed WebContents");
    return this.url;
  }
  getTitle() {
    return "Example";
  }
  getOSProcessId() {
    assert.equal(this.destroyed, false);
    return 42;
  }
  async loadURL(url: string) {
    this.url = url;
    this.emit("did-navigate");
    this.emit("dom-ready");
  }
  close() {
    this.destroyed = true;
    this.debugger.emit("detach");
    this.emit("destroyed");
  }
}
class View {
  contents = new Contents();
  missing = false;
  get webContents() {
    // Electron drops the view's wrapper during native teardown, before all CDP events finish.
    return this.missing ? undefined : this.contents;
  }
}
const agents: string[] = [];
const configuredSession = {
  setUserAgent(ua: string) {
    agents.push(ua);
  },
  setPermissionRequestHandler() {},
  on() {},
};
const key = Symbol.for("apx.test.browser-host");
Object.assign(globalThis, {
  [key]: {
    app: { userAgentFallback: "Chrome/1 Electron/1" },
    session: { fromPartition: () => configuredSession },
    WebContentsView: View,
  },
});
const hook = registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "electron")
      return {
        url: `data:text/javascript,${encodeURIComponent('const n = globalThis[Symbol.for("apx.test.browser-host")]; export const app = n.app; export const session = n.session; export const WebContentsView = n.WebContentsView;')}`,
        shortCircuit: true,
      };
    return next(specifier, context);
  },
});
const { BrowserHost } = await import("./host.ts");
hook.deregister();
Reflect.deleteProperty(globalThis, key);

async function opened(host: InstanceType<typeof BrowserHost>) {
  const tab = await host.open("https://example.com", "shared", { kind: "idle" });
  const view = tab.view as unknown as View;
  return { tab, view, wc: view.contents };
}

test("CDP invalidation survives a missing view wrapper and retires destroyed contents", async () => {
  const host = new BrowserHost();
  const { tab, view, wc } = await opened(host);
  const lists: string[][] = [];
  host.on("changed", () => lists.push(host.list().map((t) => t.tab)));
  view.missing = true;
  wc.debugger.emit("detach");
  assert.deepEqual(lists.at(-1), [tab.id]);
  wc.close();
  assert.deepEqual(host.list(), []);
  assert.equal(host.active, undefined);
  assert.deepEqual([...host.processOwners()], []);
  assert.deepEqual(lists.at(-1), []);
  await assert.rejects(host.handle("browser.snapshot", { tab: tab.id }), /unknown tab/);
});

test("external destruction selects a live sibling and stale invalidations cannot resurrect the tab", async () => {
  const host = new BrowserHost();
  const first = await opened(host);
  const second = await opened(host);
  const shown: unknown[] = [];
  host.onShow = (view) => shown.push(view);
  host.on("changed", () => host.list());
  second.view.missing = true;
  second.wc.close();
  assert.equal(host.active, first.tab.id);
  assert.equal(shown.at(-1), first.tab.view);
  second.wc.emit("did-navigate");
  second.wc.debugger.emit("detach");
  assert.deepEqual(
    host.list().map((t) => t.tab),
    [first.tab.id],
  );
  first.wc.close();
  assert.equal(shown.at(-1), undefined);
});

test("close publishes removal before reentrant layout and preserves the selection made by it", async () => {
  const host = new BrowserHost();
  const first = await opened(host);
  const alternate = await opened(host);
  const second = await opened(host);
  host.onShow = (view) => {
    assert.equal(
      host.list().some((t) => t.tab === second.tab.id),
      false,
    );
    assert.notEqual(host.active, second.tab.id);
    if (view === alternate.tab.view) host.select(first.tab.id);
  };
  host.on("changed", () => host.list());
  await host.close(second.tab.id);
  assert.equal(host.active, first.tab.id);
  assert.equal(second.wc.destroyed, true);
  await assert.rejects(host.close(second.tab.id), /unknown tab/);
  host.onShow = () => {};
  await host.close(first.tab.id);
  await host.close(alternate.tab.id);
  assert.deepEqual(host.list(), []);
});

test("external destruction settles a pending handoff without reading the dead page", async () => {
  const host = new BrowserHost();
  const { tab, wc } = await opened(host);
  const handoff = host.handle("browser.handoff", { tab: tab.id, by: "test", reason: "continue", timeout_s: 60 });
  wc.close();
  assert.deepEqual(await handoff, { resolved: false, url: "", title: "" });
  assert.deepEqual(host.list(), []);
});

test("incognito close updates selection before storage cleanup and does not overwrite a later selection", async () => {
  const host = new BrowserHost();
  const first = await opened(host);
  const second = await opened(host);
  const tab = await host.open("https://example.com", "incognito", { kind: "idle" });
  const view = tab.view as unknown as View;
  const cleanup = Promise.withResolvers<void>();
  let cleared = 0;
  view.contents.session.clearStorageData = () => {
    cleared++;
    return cleanup.promise;
  };
  view.contents.session.clearCache = async () => {
    cleared++;
  };
  const close = host.close(tab.id);
  assert.equal(host.active, second.tab.id);
  await Promise.resolve();
  assert.equal(cleared, 2);
  host.select(first.tab.id);
  cleanup.resolve();
  await close;
  assert.equal(host.active, first.tab.id);
  first.wc.close();
  second.wc.close();
});

test("external destruction clears private storage and cache exactly once despite stale native events", async () => {
  const host = new BrowserHost();
  const tab = await host.open("https://example.com", "incognito", { kind: "idle" });
  const view = tab.view as unknown as View;
  const calls: string[] = [];
  view.contents.session.clearStorageData = async () => {
    calls.push("storage");
  };
  view.contents.session.clearCache = async () => {
    calls.push("cache");
  };
  view.missing = true;
  view.contents.close();
  view.contents.emit("destroyed");
  view.contents.debugger.emit("detach");
  await Promise.resolve();
  assert.deepEqual(calls.sort(), ["cache", "storage"]);
  assert.deepEqual(host.list(), []);
  await assert.rejects(host.close(tab.id), /unknown tab/);
});

test("native destruction racing with explicit close shares one private-session cleanup", async () => {
  const host = new BrowserHost();
  const tab = await host.open("https://example.com", "incognito", { kind: "idle" });
  const view = tab.view as unknown as View;
  const cleanup = Promise.withResolvers<void>();
  let storage = 0;
  let cache = 0;
  view.contents.session.clearStorageData = () => {
    storage++;
    return cleanup.promise;
  };
  view.contents.session.clearCache = async () => {
    cache++;
  };
  host.onShow = () => view.contents.close();
  const closing = host.close(tab.id);
  view.contents.emit("destroyed");
  cleanup.resolve();
  await closing;
  assert.equal(storage, 1);
  assert.equal(cache, 1);
  assert.deepEqual(host.list(), []);
});

test("navigation still updates URL and invalidates document consent without retiring live tabs", async () => {
  const host = new BrowserHost();
  const { tab, wc } = await opened(host);
  const before = host.list()[0]?.consent_epoch;
  await host.userNavigate(tab.id, "https://example.com/next");
  assert.equal(host.list()[0]?.url, "https://example.com/next");
  assert.notEqual(host.list()[0]?.consent_epoch, before);
  assert.equal(host.active, tab.id);
  wc.close();
});

test("tabs keep the engine's own user agent", async () => {
  const host = new BrowserHost();
  const { wc } = await opened(host);
  // A tab that claims to be Chrome has Cloudflare's pass refused on every reload. See HISTORY.md#tab-user-agent
  assert.deepEqual(agents, []);
  wc.close();
});

/**
 * A page whose button (e1) opens `dialog`. Like Chromium, the click answers only once the dialog closes and nothing that
 * runs in the page answers while it is open; Electron's own box for it waits for "-cancel-dialogs".
 */
function withDialog(wc: Contents, dialog: { type: string; message: string }) {
  const sent: string[] = [];
  let open = false;
  let release = () => {};
  const event = (method: string, params: object) => wc.debugger.emit("message", {}, method, params);
  wc.debugger.sendCommand = (async (method: string, params?: { type?: string; accept?: boolean }) => {
    sent.push(method);
    if (method === "Page.handleJavaScriptDialog") {
      open = false;
      event("Page.javascriptDialogClosed", { result: params?.accept });
      release();
      return {};
    }
    if (open) return new Promise(() => {});
    if (method === "Runtime.evaluate") return { result: { objectId: "doc1" } };
    if (method === "DOM.getContentQuads") return { quads: [[0, 0, 10, 0, 10, 10, 0, 10]] };
    if (method === "Accessibility.getFullAXTree")
      return {
        nodes: [
          { nodeId: "r", role: { value: "RootWebArea" }, childIds: ["b"] },
          { nodeId: "b", parentId: "r", role: { value: "button" }, name: { value: "Delete" }, backendDOMNodeId: 2 },
        ],
      };
    if (method === "Input.dispatchMouseEvent" && params?.type === "mouseReleased") {
      open = true;
      setImmediate(() => event("Page.javascriptDialogOpening", dialog));
      return new Promise<void>((resolve) => {
        release = resolve;
      });
    }
    return {};
  }) as never;
  let boxesClosed = 0;
  wc.on("-cancel-dialogs", () => boxesClosed++);
  return { sent, boxesClosed: () => boxesClosed };
}

test("an agent sees a confirm dialog its click opened, answers it, and Electron's box for it closes", async () => {
  const host = new BrowserHost();
  const { tab, wc } = await opened(host);
  const page = withDialog(wc, { type: "confirm", message: "Delete Acme for good?" });
  await host.handle("browser.snapshot", { tab: tab.id });
  assert.deepEqual(await host.handle("browser.click", { tab: tab.id, ref: "e1", by: "superagent" }), {
    ok: true,
    url: "https://example.com",
    dialog: "confirm",
  });
  const snap = (await host.handle("browser.snapshot", { tab: tab.id })) as { tree: string };
  assert.match(snap.tree, /- dialog confirm "Delete Acme for good\?" \(the page waits for an answer\)/);
  assert.match(snap.tree, /button "OK" \[dialog-ok\]\n {2}- button "Cancel" \[dialog-cancel\]/);
  await assert.rejects(host.handle("browser.text", { tab: tab.id }), { code: "conflict" });
  await host.handle("browser.click", { tab: tab.id, ref: "dialog-ok", by: "superagent" });
  assert.equal(page.sent.at(-1), "Page.handleJavaScriptDialog");
  assert.equal(page.boxesClosed(), 1);
  assert.match(((await host.handle("browser.snapshot", { tab: tab.id })) as { tree: string }).tree, /\[e1\]/);
  wc.close();
});

test("a dialog on a tab the owner holds stays theirs", async () => {
  const host = new BrowserHost();
  const { tab, wc } = await opened(host);
  const page = withDialog(wc, { type: "confirm", message: "Leave the team?" });
  await host.handle("browser.snapshot", { tab: tab.id });
  await host.handle("browser.click", { tab: tab.id, ref: "e1", by: "superagent" });
  host.takeControl(tab.id);
  await assert.rejects(host.handle("browser.snapshot", { tab: tab.id }), { code: "paused_by_user" });
  await assert.rejects(host.handle("browser.click", { tab: tab.id, ref: "dialog-ok", by: "superagent" }), {
    code: "paused_by_user",
  });
  assert.equal(page.sent.includes("Page.handleJavaScriptDialog"), false);
  assert.equal(page.boxesClosed(), 0);
  wc.close();
});
