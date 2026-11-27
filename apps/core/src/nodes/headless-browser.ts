// The core's own browser for when no desktop app lends one (a server, a Mac with the app closed): Chrome without a
// window, driven over a pipe (no debugging port anyone else on the machine could use), started on the first browser
// call and stopped when unused. It serves the same browser.* methods as the desktop node; the owner watches a tab live
// from any panel and takes it over there (headless-live.ts). Their own logins from another computer are refused.
import { type ChildProcess, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { Readable, Writable } from "node:stream";
import {
  BROWSER_FILL_SECRET,
  BROWSER_HOLD,
  BrowserFillSecret,
  type BrowserProfile,
  browserMethods,
  createTabHolds,
  type TabControl,
  type TabInfo,
} from "@apx/protocol";
import { assertNavigable } from "@apx/protocol/browser-urls";
import type { CdpPage } from "@apx/protocol/cdp";
import { ApxError } from "@apx/protocol/client";
import { findProgram } from "../programs.ts";
import { createLiveTab, type LiveTab } from "./headless-live.ts";
import { type PageCall, type PageCdp, type PageCheck, runPageCheck } from "./page-check.ts";

const MAX_TABS = 6;
const NAV_TIMEOUT_MS = 10_000;
const START_TIMEOUT_MS = 20_000;
/** A tab nobody touched for this long is closed, unless a running turn holds it; with no tabs, Chrome stops after IDLE_MS. */
const TAB_IDLE_MS = 15 * 60_000;
const IDLE_MS = 5 * 60_000;

/** Chrome, Chromium or Edge where they usually are; APX_CHROME (config) wins. */
function findChrome(configured?: string): string | undefined {
  if (configured) return fs.existsSync(configured) ? configured : undefined;
  const fixed =
    process.platform === "darwin"
      ? [
          "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
          "/Applications/Chromium.app/Contents/MacOS/Chromium",
          "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
        ]
      : process.platform === "win32"
        ? [
            `${process.env.PROGRAMFILES ?? "C:\\Program Files"}\\Google\\Chrome\\Application\\chrome.exe`,
            `${process.env["PROGRAMFILES(X86)"] ?? "C:\\Program Files (x86)"}\\Microsoft\\Edge\\Application\\msedge.exe`,
          ]
        : [];
  return (
    fixed.find((p) => fs.existsSync(p)) ??
    ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "microsoft-edge"]
      .map((n) => findProgram(n))
      .find(Boolean)
  );
}

type Message = {
  id?: number;
  method?: string;
  params?: Record<string, unknown>;
  sessionId?: string;
  result?: unknown;
  error?: { message: string };
};

/** CDP over Chrome's pipe: JSON messages separated by a NUL byte, one session per tab (flattened). */
class Pipe {
  #id = 0;
  #pending = new Map<number, { resolve(v: unknown): void; reject(e: Error): void }>();
  #buf = "";
  #failure: string | undefined;
  readonly #out: Writable;
  readonly #beforeSend?: (method: string) => void;
  readonly #onFailure: (why: string) => void;
  constructor(
    out: Writable,
    input: Readable,
    onEvent: (m: Message) => void,
    onFailure: (why: string) => void,
    beforeSend?: (method: string) => void,
  ) {
    this.#out = out;
    this.#beforeSend = beforeSend;
    this.#onFailure = onFailure;
    input.on("error", (error: Error) => this.#fail("input pipe", error));
    out.on("error", (error: Error) => this.#fail("output pipe", error));
    input.setEncoding("utf8");
    input.on("data", (chunk: string) => {
      this.#buf += chunk;
      let end = this.#buf.indexOf("\0");
      while (end >= 0) {
        const raw = this.#buf.slice(0, end);
        this.#buf = this.#buf.slice(end + 1);
        end = this.#buf.indexOf("\0");
        let m: Message;
        try {
          m = JSON.parse(raw) as Message;
        } catch {
          continue;
        }
        const waiting = m.id === undefined ? undefined : this.#pending.get(m.id);
        if (waiting && m.id !== undefined) {
          this.#pending.delete(m.id);
          if (m.error) waiting.reject(new ApxError({ code: "unavailable", message: m.error.message }));
          else waiting.resolve(m.result);
        } else if (m.method) onEvent(m);
      }
    });
  }
  send<T>(method: string, params: object = {}, sessionId?: string): Promise<T> {
    if (this.#failure) return Promise.reject(new ApxError({ code: "unavailable", message: this.#failure }));
    const id = ++this.#id;
    return new Promise<T>((resolve, reject) => {
      this.#pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      try {
        this.#beforeSend?.(method);
        this.#out.write(`${JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })}\0`, (error) => {
          if (error) this.#fail("output pipe", error);
        });
      } catch (error) {
        this.#pending.delete(id);
        reject(new ApxError({ code: "unavailable", message: error instanceof Error ? error.message : String(error) }));
      }
    });
  }
  #fail(stream: string, error: Error) {
    if (this.#failure) return;
    const why = `headless browser ${stream} failed: ${error.message}`;
    this.failAll(why);
    this.#onFailure(why);
  }
  failAll(why: string) {
    this.#failure ??= why;
    for (const p of this.#pending.values()) p.reject(new ApxError({ code: "unavailable", message: this.#failure }));
    this.#pending.clear();
  }
}

type Tab = {
  id: string;
  target: string;
  session: string;
  profile: BrowserProfile;
  page: CdpPage;
  control: TabControl;
  url: string;
  title: string;
  used: number;
  /** The owner watching or driving it from a panel, once they look at it. */
  live?: LiveTab;
};

export function createHeadlessBrowser(deps: {
  /** Where the shared profile keeps its cookies between runs. */
  dir: string;
  chrome?: string | undefined;
  spawn?: typeof spawn;
  /** APX's own ports: a tab never loads APX itself. */
  blockedPorts: () => ReadonlySet<string>;
  onChange: (tabs: TabInfo[]) => void;
  /** A visible guest browser connected over private SSH pipes, without a host Chrome fallback. */
  remote?: {
    launch(): { child: ChildProcess; input: Readable; output: Writable };
    selectAllModifiers: number;
    check?: (method: string) => void;
    keepAlive?: () => boolean;
  };
}) {
  // Looked for once: asked on every turn (which tools to offer), and a browser installed later needs a restart anyway.
  const found = findChrome(deps.chrome);
  const bin = () => found;
  let proc: ChildProcess | undefined;
  let pipe: Pipe | undefined;
  let starting: Promise<Pipe> | undefined;
  let seq = 0;
  const tabs = new Map<string, Tab>();
  // A tab whose agent's turn ended is free again.
  const holds = createTabHolds((id) => {
    const t = tabs.get(id);
    if (t?.control.kind !== "agent") return;
    t.control = { kind: "idle" };
    changed();
  });
  const contexts = new Map<string, string>();
  const loads = new Map<string, () => void>();
  // An agent waiting for the owner to finish in a tab (sign-in, a code, a captcha).
  const handoffs = new Map<string, (done: boolean) => void>();
  const commandModifier = deps.remote?.selectAllModifiers ?? (process.platform === "darwin" ? 4 : 2);
  // A page check listens to its own tab's events.
  const listeners = new Map<string, (m: Message) => void>();
  let lastUse = Date.now();

  const info = (t: Tab): TabInfo => ({
    tab: t.id,
    url: t.page.scrub(t.url),
    title: t.page.scrub(t.title),
    profile: t.profile,
    control: t.control,
    consent_epoch: t.page.consentEpoch,
    live: true,
  });
  const changed = () => deps.onChange([...tabs.values()].map(info));
  const bySession = (s: string | undefined) => [...tabs.values()].find((t) => t.session === s);

  function onEvent(m: Message) {
    const own = m.sessionId ? listeners.get(m.sessionId) : undefined;
    if (own) return own(m);
    const tab = bySession(m.sessionId);
    if (m.method === "Fetch.requestPaused" && m.sessionId) {
      // Every document request, redirects and frames included, passes the same guard as a direct load.
      const req = m.params as { requestId: string; request: { url: string } };
      let ok = true;
      try {
        assertNavigable(req.request.url, deps.blockedPorts());
      } catch {
        ok = false;
      }
      void pipe
        ?.send(
          ok ? "Fetch.continueRequest" : "Fetch.failRequest",
          {
            requestId: req.requestId,
            ...(ok ? {} : { errorReason: "BlockedByClient" }),
          },
          m.sessionId,
        )
        .catch(() => {});
      return;
    }
    if (!tab) return;
    if (m.method === "Page.screencastFrame") return tab.live?.onFrame(m.params);
    if (m.method) tab.page.onEvent(m.method, m.params);
    if (m.method === "Page.loadEventFired") loads.get(tab.id)?.();
    if (m.method === "Page.navigatedWithinDocument") {
      tab.page.forget(true);
      tab.url = String((m.params as { url?: string }).url ?? tab.url);
      changed();
    }
    if (m.method === "Page.frameNavigated" && !(m.params as { frame?: { parentId?: string } }).frame?.parentId) {
      tab.page.forget();
      tab.url = String((m.params as { frame?: { url?: string } }).frame?.url ?? tab.url);
      changed();
    }
  }

  async function start(): Promise<Pipe> {
    const chrome = bin();
    if (deps.remote) {
      const { child, input, output } = deps.remote.launch();
      return connect(child, input, output);
    }
    if (!chrome) throw new ApxError({ code: "unavailable", message: "no Chrome, Chromium or Edge on this machine" });
    const profile = path.join(deps.dir, "shared");
    fs.mkdirSync(profile, { recursive: true });
    const child = (deps.spawn ?? spawn)(
      chrome,
      [
        "--headless=new",
        "--remote-debugging-pipe",
        `--user-data-dir=${profile}`,
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-extensions",
        "--disable-sync",
        "--disable-background-networking",
        "--disable-component-update",
        "--mute-audio",
        "--window-size=1280,900",
        "about:blank",
      ],
      { stdio: ["ignore", "ignore", "pipe", "pipe", "pipe"] },
    );
    return connect(child, child.stdio[4] as Readable, child.stdio[3] as Writable);
  }

  async function connect(child: ChildProcess, input: Readable, output: Writable): Promise<Pipe> {
    proc = child;
    const p = new Pipe(
      output,
      input,
      onEvent,
      () => {
        if (proc !== child) return;
        proc = undefined;
        pipe = undefined;
        dropTabs();
        contexts.clear();
        child.kill();
        changed();
      },
      deps.remote?.check,
    );
    child.on("exit", () => {
      if (proc !== child) return;
      p.failAll("the headless browser stopped");
      proc = undefined;
      pipe = undefined;
      dropTabs();
      contexts.clear();
      changed();
    });
    child.on("error", (error) => p.failAll(`browser transport failed: ${error.message}`));
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        p.send("Browser.getVersion"),
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new ApxError({ code: "unavailable", message: "Chrome did not start" })),
            START_TIMEOUT_MS,
          );
        }),
      ]);
    } catch (error) {
      p.failAll("browser transport did not start");
      child.kill();
      if (proc === child) proc = undefined;
      throw error;
    } finally {
      clearTimeout(timer);
    }
    pipe = p;
    return p;
  }

  const ready = async (): Promise<Pipe> => {
    lastUse = Date.now();
    if (pipe) return pipe;
    starting ??= start().finally(() => {
      starting = undefined;
    });
    return starting;
  };

  /** Every tab goes: what watched them stops, and an agent waiting on the owner there is told it did not happen. */
  function dropTabs() {
    for (const t of tabs.values()) t.live?.stop();
    for (const done of [...handoffs.values()]) done(false);
    tabs.clear();
  }

  function stop() {
    proc?.kill();
    proc = undefined;
    pipe = undefined;
    dropTabs();
    contexts.clear();
    changed();
  }

  const sweep = setInterval(() => {
    if (deps.remote?.keepAlive?.()) return;
    const now = Date.now();
    for (const t of [...tabs.values()])
      if (now - t.used > TAB_IDLE_MS && !holds.held(t.id) && !human(t)) void close(t.id).catch(() => {});
    if (proc && !tabs.size && now - lastUse > IDLE_MS) stop();
  }, 30_000);
  sweep.unref();

  async function contextFor(p: Pipe, profile: BrowserProfile): Promise<string | undefined> {
    // The shared profile is Chrome's own (kept on disk); others get a context of their own, in memory only.
    if (profile === "shared") return undefined;
    if (profile !== "incognito" && contexts.has(profile)) return contexts.get(profile);
    const { browserContextId } = await p.send<{ browserContextId: string }>("Target.createBrowserContext", {
      disposeOnDetach: true,
    });
    if (profile !== "incognito") contexts.set(profile, browserContextId);
    return browserContextId;
  }

  /** Waits for the page's load (at most `ms`); a wait left running would start Chrome again after it stopped. */
  async function settle(t: Tab, ms = NAV_TIMEOUT_MS): Promise<void> {
    await new Promise<void>((resolve) => {
      const timer = setTimeout(done, ms);
      function done() {
        clearTimeout(timer);
        if (loads.get(t.id) === done) loads.delete(t.id);
        resolve();
      }
      loads.set(t.id, done);
    });
    if (tabs.get(t.id) === t) await refresh(t);
  }

  async function refresh(t: Tab): Promise<void> {
    const p = await ready();
    const h = await p.send<{ currentIndex: number; entries: Array<{ url: string; title: string }> }>(
      "Page.getNavigationHistory",
      {},
      t.session,
    );
    const cur = h.entries[h.currentIndex];
    if (cur) {
      t.url = cur.url;
      t.title = cur.title;
    }
    changed();
  }

  async function load(t: Tab, url: string): Promise<void> {
    assertNavigable(url, deps.blockedPorts());
    const p = await ready();
    const waiting = settle(t);
    await p.send("Page.navigate", { url }, t.session);
    await waiting;
  }

  async function open(url: string, profile: BrowserProfile, control: TabControl): Promise<Tab> {
    assertNavigable(url, deps.blockedPorts());
    if (tabs.size >= MAX_TABS) throw new ApxError({ code: "unavailable", message: `tab limit (${MAX_TABS}) reached` });
    const p = await ready();
    const browserContextId = await contextFor(p, profile);
    const { targetId } = await p.send<{ targetId: string }>("Target.createTarget", {
      url: "about:blank",
      ...(browserContextId ? { browserContextId } : {}),
    });
    const { sessionId } = await p.send<{ sessionId: string }>("Target.attachToTarget", { targetId, flatten: true });
    const send = <T>(method: string, params?: object) => p.send<T>(method, params ?? {}, sessionId);
    // Runtime.enable is deliberately not called: it is a classic bot-detection signal.
    await send("Page.enable");
    await send("DOM.enable");
    await send("Accessibility.enable");
    await send("Fetch.enable", { patterns: [{ resourceType: "Document" }] });
    const { userAgent } = await p.send<{ userAgent: string }>("Browser.getVersion");
    await send("Network.setUserAgentOverride", { userAgent: userAgent.replace("HeadlessChrome", "Chrome") });
    const { CdpPage } = await import("@apx/protocol/cdp");
    const t: Tab = {
      id: `${deps.remote ? "vm-" : "h"}${++seq}`,
      target: targetId,
      session: sessionId,
      profile,
      page: new CdpPage(send, {
        selectAllModifiers: commandModifier,
      }),
      control,
      url: "about:blank",
      title: "",
      used: Date.now(),
    };
    tabs.set(t.id, t);
    await load(t, url);
    if (deps.remote) await p.send("Target.activateTarget", { targetId });
    return t;
  }

  async function close(id: string): Promise<void> {
    const t = get(id);
    tabs.delete(id);
    t.live?.stop();
    handoffs.get(id)?.(false);
    await pipe?.send("Target.closeTarget", { targetId: t.target }).catch(() => {});
    changed();
  }

  function get(id: string): Tab {
    const t = tabs.get(id);
    if (!t) throw new ApxError({ code: "not_found", message: `no tab ${id}` });
    t.used = Date.now();
    return t;
  }

  /** The owner has the tab: what they type there is theirs, so agents neither act in it nor read it. */
  const human = (t: Tab) => t.control.kind === "user" || t.control.kind === "handoff" || handoffs.has(t.id);
  const ownerHas = () =>
    new ApxError({ code: "paused_by_user", message: "the human has this tab right now; wait or ask them" });
  function readable(id: string): Tab {
    const t = get(id);
    if (human(t)) throw ownerHas();
    return t;
  }

  /** The agent drives the tab; another agent's tab, or one the owner holds, is refused (the core checks too). */
  function drive(id: string, by: string): Tab {
    const t = get(id);
    if (human(t)) throw ownerHas();
    if (t.control.kind === "agent" && t.control.by !== by)
      throw new ApxError({ code: "paused_by_user", message: `tab ${id} is in use by ${t.control.by}` });
    t.control = { kind: "agent", by, since: new Date().toISOString() };
    return t;
  }

  /** Each command goes through ready(): a page in use keeps the browser from stopping as idle. */
  async function pageCdp(): Promise<PageCdp> {
    await ready();
    return {
      send: async (method, params, session) => (await ready()).send(method, params ?? {}, session),
      listen: (session, fn) => {
        listeners.set(session, fn);
        return () => listeners.delete(session);
      },
    };
  }

  /** The tab's live view, made the first time the owner looks at it. */
  async function liveOf(t: Tab): Promise<LiveTab> {
    const p = await ready();
    t.live ??= createLiveTab((method, params) => p.send(method, params ?? {}, t.session), {
      commandModifier,
      activate: () => p.send("Target.activateTarget", { targetId: t.target }),
    });
    return t.live;
  }

  /** The owner takes the tab, or gives it back; `done` finishes an agent's handoff (it resumes). */
  function setControl(t: Tab, mode: "user" | "idle" | "done"): void {
    if (mode === "user") t.control = { kind: "user", since: new Date().toISOString() };
    else {
      const waiter = handoffs.get(t.id);
      if (waiter) {
        waiter(mode === "done");
        return;
      }
      t.control = { kind: "idle" };
    }
    changed();
  }

  return {
    /** Whether a browser could start here (nothing is started to find out). */
    available: () => Boolean(deps.remote || bin()),
    running: () => Boolean(proc),
    list: (): TabInfo[] => [...tabs.values()].map(info),
    stop,
    close: () => {
      clearInterval(sweep);
      stop();
    },
    /** Runs an artifact's page in a throwaway tab (no network, no cookies): the errors it threw and what it shows. */
    async checkPage(html: string, onCall: PageCall): Promise<PageCheck> {
      return runPageCheck(await pageCdp(), html, onCall);
    },
    /** The browser itself, for pages the core runs on its own (a widget in edit mode), started if needed. */
    pageCdp,
    async handle(method: string, raw: unknown): Promise<unknown> {
      const out = await serve(method, raw);
      // A page may carry a filled value on into its address or title (a form sent by GET).
      const t = tabs.get(String((raw as { tab?: unknown } | null)?.tab ?? ""));
      return t && method !== "browser.screenshot" && method !== "browser.frame"
        ? (await import("@apx/protocol/cdp")).scrubDeep(out, (x) => t.page.scrub(x))
        : out;
    },
  };

  async function serve(method: string, raw: unknown): Promise<unknown> {
    switch (method) {
      case BROWSER_HOLD:
        return holds.set(raw);
      case "browser.tabs":
        return { tabs: [...tabs.values()].map(info) };
      case "browser.open": {
        const p = browserMethods["browser.open"].params.parse(raw);
        const control: TabControl =
          p.by === "operator" ? { kind: "idle" } : { kind: "agent", by: p.by, since: new Date().toISOString() };
        return info(await open(p.url, p.profile, control));
      }
      case "browser.navigate": {
        const p = browserMethods["browser.navigate"].params.parse(raw);
        const t = p.by === "operator" ? get(p.tab) : drive(p.tab, p.by);
        await load(t, p.url);
        return { url: t.url, title: t.title };
      }
      case "browser.history": {
        const p = browserMethods["browser.history"].params.parse(raw);
        const t = p.by === "operator" ? get(p.tab) : drive(p.tab, p.by);
        const pp = await ready();
        if (p.action === "reload") {
          const waiting = settle(t);
          await pp.send("Page.reload", {}, t.session);
          await waiting;
        } else {
          const h = await pp.send<{ currentIndex: number; entries: Array<{ id: number }> }>(
            "Page.getNavigationHistory",
            {},
            t.session,
          );
          const entry = h.entries[h.currentIndex + (p.action === "back" ? -1 : 1)];
          if (entry) {
            const waiting = settle(t);
            await pp.send("Page.navigateToHistoryEntry", { entryId: entry.id }, t.session);
            await waiting;
          }
        }
        return { url: t.url, title: t.title };
      }
      case "browser.snapshot": {
        const p = browserMethods["browser.snapshot"].params.parse(raw);
        const t = readable(p.tab);
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
        const t = drive(p.tab, p.by);
        const dialog = await t.page.click(p.ref);
        if (dialog) await refresh(t);
        else await settle(t, 1500);
        return { ok: true, url: t.url, ...(dialog ? { dialog } : {}) };
      }
      case "browser.type": {
        const p = browserMethods["browser.type"].params.parse(raw);
        const t = drive(p.tab, p.by);
        // Checked here, at the moment it types, from the page itself (DECISIONS.md#d-212).
        const dialog = await t.page.type(
          p.ref,
          p.text,
          p.submit,
          p.local_only ? deps.blockedPorts() : undefined,
          p.upload,
        );
        if (p.submit && !dialog) await settle(t, 2000);
        else await refresh(t);
        return { ok: true, url: t.url, ...(dialog ? { dialog } : {}) };
      }
      case BROWSER_FILL_SECRET: {
        const p = BrowserFillSecret.parse(raw);
        return drive(p.tab, p.by).page.fillSecret(p.ref, p);
      }
      case "browser.approval_context": {
        const p = browserMethods["browser.approval_context"].params.parse(raw);
        return readable(p.tab).page.approvalContext(p.origin, p.document);
      }
      case "browser.evaluate": {
        const p = browserMethods["browser.evaluate"].params.parse(raw);
        const t = drive(p.tab, p.by);
        const result = await t.page.evaluate(p.script, p.origin, p.document, p.epoch);
        return { url: t.url, ...result };
      }
      case "browser.screenshot": {
        const p = browserMethods["browser.screenshot"].params.parse(raw);
        const t = get(p.tab);
        // A tab in the background paints nothing to take a picture of (macOS).
        await (await ready()).send("Target.activateTarget", { targetId: t.target }).catch(() => {});
        const data = await t.page.screenshot();
        return { mime: "image/jpeg", data, bytes: Buffer.byteLength(data, "base64") };
      }
      case "browser.frame": {
        const p = browserMethods["browser.frame"].params.parse(raw);
        const frame = await (await liveOf(get(p.tab))).frame(p.after, p.max_width, p.wait_ms);
        return { mime: "image/jpeg", ...frame };
      }
      case "browser.input": {
        const p = browserMethods["browser.input"].params.parse(raw);
        const t = get(p.tab);
        if (!human(t))
          throw new ApxError({ code: "conflict", message: "take control of the tab first, then click and type" });
        await (await liveOf(t)).input(p.events);
        return { ok: true };
      }
      case "browser.inspect": {
        const p = browserMethods["browser.inspect"].params.parse(raw);
        return { element: await get(p.tab).page.inspect(p.x, p.y) };
      }
      case "browser.edit_elements": {
        const p = browserMethods["browser.edit_elements"].params.parse(raw);
        return { elements: await get(p.tab).page.editElements() };
      }
      case "browser.preview_edits": {
        const p = browserMethods["browser.preview_edits"].params.parse(raw);
        const t = get(p.tab);
        // Changing the page under an agent would hand it a page its own code never made.
        if (t.control.kind === "agent")
          throw new ApxError({ code: "paused_by_user", message: `tab ${p.tab} is in use by ${t.control.by}` });
        return t.page.previewEdits(p.edits);
      }
      case "browser.text": {
        const p = browserMethods["browser.text"].params.parse(raw);
        const t = readable(p.tab);
        t.page.assertNoDialog();
        const pp = await ready();
        const tree = await pp.send<{ frameTree: { frame: { id: string } } }>("Page.getFrameTree", {}, t.session);
        // An isolated world: the page's scripts cannot see or patch this read.
        const { executionContextId } = await pp.send<{ executionContextId: number }>(
          "Page.createIsolatedWorld",
          { frameId: tree.frameTree.frame.id, worldName: "apx" },
          t.session,
        );
        const r = await pp.send<{ result: { value?: unknown } }>(
          "Runtime.evaluate",
          {
            expression: "document.body ? document.body.innerText : ''",
            contextId: executionContextId,
            returnByValue: true,
          },
          t.session,
        );
        t.page.assertReadable();
        const text = t.page.scrub(String(r.result.value ?? "")).replace(/\n{3,}/g, "\n\n");
        const slice = text.slice(p.offset, p.offset + p.max_chars);
        return { url: t.url, text: slice, total: text.length, truncated: p.offset + p.max_chars < text.length };
      }
      case "browser.control": {
        const p = browserMethods["browser.control"].params.parse(raw);
        const t = get(p.tab);
        setControl(t, p.mode);
        // A finished handoff sets the agent's control as it resumes.
        await new Promise((r) => setImmediate(r));
        return info(t);
      }
      case "browser.handoff": {
        const p = browserMethods["browser.handoff"].params.parse(raw);
        const t = get(p.tab);
        if (handoffs.has(t.id) || t.control.kind === "handoff")
          throw new ApxError({ code: "paused_by_user", message: "this tab is already waiting for the human" });
        t.control = { kind: "handoff", by: p.by, reason: p.reason, since: new Date().toISOString() };
        changed();
        const done = await new Promise<boolean>((resolve) => {
          const waiter = (ok: boolean) => {
            clearTimeout(timer);
            if (handoffs.get(t.id) === waiter) handoffs.delete(t.id);
            resolve(ok);
          };
          const timer = setTimeout(() => waiter(false), p.timeout_s * 1000);
          handoffs.set(t.id, waiter);
        });
        if (tabs.get(t.id) !== t) return { resolved: false, url: "", title: "" };
        t.control = done ? { kind: "agent", by: p.by, since: new Date().toISOString() } : { kind: "idle" };
        changed();
        await refresh(t).catch(() => {});
        return { resolved: done, url: t.page.scrub(t.url), title: t.page.scrub(t.title) };
      }
      case "browser.cookie_sources":
        return { sources: [] };
      case "browser.cookie_domains":
      case "browser.import_cookies":
        throw new ApxError({
          code: "unavailable",
          message: "the owner's logins come from the APX app on their computer: open it to bring them in",
        });
      case "browser.close": {
        const p = browserMethods["browser.close"].params.parse(raw);
        await close(p.tab);
        return { ok: true };
      }
      default:
        throw new ApxError({ code: "unknown_method", message: `the headless browser does not serve ${method}` });
    }
  }
}

export type HeadlessBrowser = ReturnType<typeof createHeadlessBrowser>;
