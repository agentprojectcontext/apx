// The browser.* methods on the owner's Chrome: the tabs of its "APX" group, driven with the same CdpPage as APX's own
// browsers, through APX's extension. The owner shares a tab by moving it into the group; their other tabs are never
// seen. What needs APX's own browser (its profiles, stored logins, page JavaScript) is refused with a reason.
import {
  BROWSER_HOLD,
  browserMethods,
  ChromeTabRow,
  chromeTab,
  chromeTabId,
  type TabControl,
  type TabInfo,
} from "@apx/protocol";
import { assertNavigable, CdpPage, scrubDeep } from "@apx/protocol/cdp";
import { ApxError } from "@apx/protocol/client";
import type { ExtensionLink } from "./wire.ts";

const NAV_TIMEOUT_MS = 10_000;
const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]", "0.0.0.0"]);

type Tab = {
  chrome: number;
  page: CdpPage;
  control: TabControl;
  url: string;
  title: string;
  /** The tab's DevTools domains turned on (after the debugger attached); dropped when it detaches. */
  ready: Promise<void> | undefined;
};

export function createChromeTabs(deps: {
  link: ExtensionLink;
  /** APX's own ports: a tab never loads APX itself (it would hold the owner's controls). */
  blockedPorts: ReadonlySet<string>;
  selectAllModifiers: number;
}) {
  const tabs = new Map<number, Tab>();
  const loads = new Map<number, () => void>();
  const sendTo =
    (tab: number) =>
    <T>(method: string, params?: object) =>
      deps.link.request<T>({ t: "cdp", tab, method, params: (params ?? {}) as Record<string, unknown> });

  const add = (row: ChromeTabRow): Tab => {
    const t: Tab = {
      chrome: row.tab,
      page: new CdpPage(sendTo(row.tab), { selectAllModifiers: deps.selectAllModifiers }),
      control: { kind: "idle" },
      url: row.url,
      title: row.title,
      ready: undefined,
    };
    tabs.set(row.tab, t);
    return t;
  };

  /** The group as Chrome has it now: a tab the owner moved in appears, one closed or moved out goes. */
  async function sync(): Promise<void> {
    const rows = ChromeTabRow.array().parse(await deps.link.request({ t: "list" }));
    const seen = new Set(rows.map((r) => r.tab));
    for (const id of tabs.keys()) if (!seen.has(id)) tabs.delete(id);
    for (const row of rows) {
      const t = tabs.get(row.tab) ?? add(row);
      if (!t.ready) {
        t.url = row.url;
        t.title = row.title;
      }
    }
  }

  const info = (t: Tab): TabInfo => ({
    tab: chromeTab(t.chrome),
    url: t.page.scrub(t.url),
    title: t.page.scrub(t.title),
    profile: "shared",
    control: t.control,
    consent_epoch: t.page.consentEpoch,
  });

  async function get(id: string): Promise<Tab> {
    const n = chromeTabId(id);
    if (n !== undefined && !tabs.has(n)) await sync();
    const t = n === undefined ? undefined : tabs.get(n);
    if (!t) throw new ApxError({ code: "not_found", message: `no tab ${id} in Chrome's APX group` });
    return t;
  }

  /** Turns the tab's DevTools domains on once per attach; every document load passes the same guard as a direct one. */
  function prepare(t: Tab): Promise<void> {
    t.ready ??= (async () => {
      const send = sendTo(t.chrome);
      // Runtime.enable is deliberately not called: pages can notice it.
      await send("Page.enable");
      await send("DOM.enable");
      await send("Accessibility.enable");
      await send("Fetch.enable", { patterns: [{ resourceType: "Document" }] });
    })().catch((error: unknown) => {
      t.ready = undefined;
      throw error;
    });
    return t.ready;
  }

  /**
   * A tab that shows APX itself holds the owner's controls: it is never read or driven, however it got into the group
   * (a page that opened it, the owner dragging it in). Checked on the tab's live address.
   */
  async function assertNotApx(t: Tab): Promise<void> {
    await refresh(t);
    let u: URL | undefined;
    try {
      u = new URL(t.url);
    } catch {}
    if (u && LOOPBACK.has(u.hostname) && deps.blockedPorts.has(u.port || "80"))
      throw new ApxError({ code: "bad_request", message: "this tab shows APX itself: APX never works in it" });
  }

  /** The agent drives the tab; while the owner holds it, or another agent drives it, it is refused. */
  async function drive(id: string, by: string): Promise<Tab> {
    const t = await get(id);
    if (t.control.kind === "user")
      throw new ApxError({
        code: "paused_by_user",
        message: `the owner stopped APX in tab ${id}: open a new tab if you still need one`,
      });
    if (t.control.kind === "agent" && t.control.by !== by)
      throw new ApxError({ code: "paused_by_user", message: `tab ${id} is in use by ${t.control.by}` });
    await prepare(t);
    await assertNotApx(t);
    t.control = { kind: "agent", by, since: new Date().toISOString() };
    return t;
  }

  async function read(id: string): Promise<Tab> {
    const t = await get(id);
    if (t.control.kind === "user")
      throw new ApxError({
        code: "paused_by_user",
        message: `the owner stopped APX in tab ${id}: open a new tab if you still need one`,
      });
    await prepare(t);
    await assertNotApx(t);
    return t;
  }

  async function refresh(t: Tab): Promise<void> {
    const h = await sendTo(t.chrome)<{ currentIndex: number; entries: Array<{ url: string; title: string }> }>(
      "Page.getNavigationHistory",
    );
    const cur = h.entries[h.currentIndex];
    if (cur) {
      t.url = cur.url;
      t.title = cur.title;
    }
  }

  async function settle(t: Tab, ms = NAV_TIMEOUT_MS): Promise<void> {
    await new Promise<void>((resolve) => {
      const timer = setTimeout(done, ms);
      function done() {
        clearTimeout(timer);
        loads.delete(t.chrome);
        resolve();
      }
      loads.set(t.chrome, done);
    });
    await refresh(t);
  }

  async function load(t: Tab, url: string): Promise<void> {
    assertNavigable(url, deps.blockedPorts);
    const waiting = settle(t);
    await sendTo(t.chrome)("Page.navigate", { url });
    await waiting;
  }

  deps.link.onEvent = (tab, method, params) => {
    const t = tabs.get(tab);
    if (method === "Fetch.requestPaused") {
      const req = params as { requestId: string; request: { url: string } };
      let ok = true;
      try {
        assertNavigable(req.request.url, deps.blockedPorts);
      } catch {
        ok = false;
      }
      void sendTo(tab)(ok ? "Fetch.continueRequest" : "Fetch.failRequest", {
        requestId: req.requestId,
        ...(ok ? {} : { errorReason: "BlockedByClient" }),
      }).catch(() => {});
      return;
    }
    if (!t) return;
    if (method === "Page.loadEventFired") loads.get(tab)?.();
    if (method === "Page.navigatedWithinDocument") {
      t.page.forget(true);
      t.url = String(params.url ?? t.url);
    }
    if (method === "Page.frameNavigated" && !(params.frame as { parentId?: string } | undefined)?.parentId) {
      t.page.forget();
      t.url = String((params.frame as { url?: string } | undefined)?.url ?? t.url);
    }
  };
  deps.link.onDetached = (tab, reason) => {
    const t = tabs.get(tab);
    if (!t) return;
    t.ready = undefined;
    // Cancel on Chrome's "started debugging" bar: the owner took the tab back, and APX stays out of it.
    if (reason === "canceled_by_user") t.control = { kind: "user", since: new Date().toISOString() };
    else if (reason === "target_closed") tabs.delete(tab);
  };
  deps.link.onTabs = () => void sync().catch(() => {});

  const refuse = (message: string) => new ApxError({ code: "unavailable", message });

  async function serve(method: string, raw: unknown): Promise<unknown> {
    switch (method) {
      case BROWSER_HOLD:
        // The owner's own tabs are never closed for being idle: there is nothing to hold.
        return { ok: true };
      case "browser.tabs":
        await sync();
        return { tabs: [...tabs.values()].map(info) };
      case "browser.open": {
        const p = browserMethods["browser.open"].params.parse(raw);
        if (p.profile !== "shared")
          throw refuse("this agent browses in a profile of its own; the owner's Chrome has only theirs");
        assertNavigable(p.url, deps.blockedPorts);
        const { tab } = (await deps.link.request({ t: "open" })) as { tab: number };
        const t = tabs.get(tab) ?? add({ tab, url: "about:blank", title: "" });
        if (p.by !== "operator") t.control = { kind: "agent", by: p.by, since: new Date().toISOString() };
        await prepare(t);
        await load(t, p.url);
        return info(t);
      }
      case "browser.navigate": {
        const p = browserMethods["browser.navigate"].params.parse(raw);
        const t = await drive(p.tab, p.by);
        await load(t, p.url);
        return { url: t.url, title: t.title };
      }
      case "browser.history": {
        const p = browserMethods["browser.history"].params.parse(raw);
        const t = await drive(p.tab, p.by);
        const send = sendTo(t.chrome);
        if (p.action === "reload") {
          const waiting = settle(t);
          await send("Page.reload");
          await waiting;
        } else {
          const h = await send<{ currentIndex: number; entries: Array<{ id: number }> }>("Page.getNavigationHistory");
          const entry = h.entries[h.currentIndex + (p.action === "back" ? -1 : 1)];
          if (entry) {
            const waiting = settle(t);
            await send("Page.navigateToHistoryEntry", { entryId: entry.id });
            await waiting;
          }
        }
        return { url: t.url, title: t.title };
      }
      case "browser.snapshot": {
        const p = browserMethods["browser.snapshot"].params.parse(raw);
        const t = await read(p.tab);
        const snap = await t.page.snapshot(p.max_chars);
        // Page text is data, never instructions, wherever it ends up (rule 10).
        const tree = `<untrusted_web source="${t.url}">\n${snap.tree}\n</untrusted_web>`;
        return {
          url: t.url,
          title: t.title,
          tree,
          refs: snap.refs,
          truncated: snap.truncated,
          document: snap.document,
        };
      }
      case "browser.click": {
        const p = browserMethods["browser.click"].params.parse(raw);
        const t = await drive(p.tab, p.by);
        await t.page.click(p.ref);
        await settle(t, 1500);
        return { ok: true, url: t.url };
      }
      case "browser.type": {
        const p = browserMethods["browser.type"].params.parse(raw);
        const t = await drive(p.tab, p.by);
        await t.page.type(p.ref, p.text, p.submit);
        if (p.submit) await settle(t, 2000);
        else await refresh(t);
        return { ok: true, url: t.url };
      }
      case "browser.screenshot": {
        const p = browserMethods["browser.screenshot"].params.parse(raw);
        const t = await read(p.tab);
        // A tab behind others has no picture to take.
        await deps.link.request({ t: "show", tab: t.chrome });
        const data = await t.page.screenshot();
        return { mime: "image/jpeg", data, bytes: Buffer.byteLength(data, "base64") };
      }
      case "browser.text": {
        const p = browserMethods["browser.text"].params.parse(raw);
        const t = await read(p.tab);
        const send = sendTo(t.chrome);
        const frames = await send<{ frameTree: { frame: { id: string } } }>("Page.getFrameTree");
        // An isolated world: the page's scripts cannot see or patch this read.
        const { executionContextId } = await send<{ executionContextId: number }>("Page.createIsolatedWorld", {
          frameId: frames.frameTree.frame.id,
          worldName: "apx",
        });
        const r = await send<{ result: { value?: unknown } }>("Runtime.evaluate", {
          expression: "document.body ? document.body.innerText : ''",
          contextId: executionContextId,
          returnByValue: true,
        });
        t.page.assertReadable();
        const text = t.page.scrub(String(r.result.value ?? "")).replace(/\n{3,}/g, "\n\n");
        const slice = text.slice(p.offset, p.offset + p.max_chars);
        return { url: t.url, text: slice, total: text.length, truncated: p.offset + p.max_chars < text.length };
      }
      case "browser.control": {
        const p = browserMethods["browser.control"].params.parse(raw);
        const t = await get(p.tab);
        t.control = p.mode === "user" ? { kind: "user", since: new Date().toISOString() } : { kind: "idle" };
        return info(t);
      }
      case "browser.close": {
        const p = browserMethods["browser.close"].params.parse(raw);
        const t = await get(p.tab);
        await deps.link.request({ t: "close", tab: t.chrome });
        tabs.delete(t.chrome);
        return { ok: true };
      }
      case "browser.handoff":
        throw refuse("the owner is in their Chrome: ask them in the chat to do it in the tab, and go on when they say");
      case "browser.evaluate":
      case "browser.approval_context":
        throw refuse("page JavaScript runs only in APX's own browser, not in the owner's Chrome");
      case "browser.cookie_sources":
        return { sources: [] };
      case "browser.cookie_domains":
      case "browser.import_cookies":
        throw refuse("the owner's Chrome already has their logins: nothing to bring in");
      default:
        throw new ApxError({ code: "unknown_method", message: `the owner's Chrome does not serve ${method}` });
    }
  }

  return {
    async handle(method: string, raw: unknown): Promise<unknown> {
      const out = await serve(method, raw);
      const n = chromeTabId(String((raw as { tab?: unknown } | null)?.tab ?? ""));
      const t = n === undefined ? undefined : tabs.get(n);
      return t && method !== "browser.screenshot" ? scrubDeep(out, (x) => t.page.scrub(x)) : out;
    },
    list: () => [...tabs.values()].map(info),
  };
}
