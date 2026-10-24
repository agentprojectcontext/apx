// The core's own browser for when no desktop app lends one (a server, a Mac with the app closed): Chrome without a
// window, driven over a pipe (no debugging port anyone else on the machine could use), started on the first browser
// call and stopped when unused. It serves the same browser.* methods as the desktop node; what needs a human there
// (taking over, the owner's own logins) is refused with a clear reason.
import { type ChildProcess, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { Readable, Writable } from "node:stream";
import {
  BROWSER_HOLD,
  type BrowserProfile,
  browserMethods,
  createTabHolds,
  type TabControl,
  type TabInfo,
} from "@apx/protocol";
import { assertNavigable, CdpPage } from "@apx/protocol/cdp";
import { ApxError } from "@apx/protocol/client";
import { findProgram } from "../programs.ts";
import { type PageCall, type PageCheck, runPageCheck } from "./page-check.ts";

const MAX_TABS = 6;
const NAV_TIMEOUT_MS = 10_000;
const START_TIMEOUT_MS = 20_000;
/** A tab nobody touched for this long is closed, unless a running turn holds it; with no tabs, Chrome stops after IDLE_MS. */
const TAB_IDLE_MS = 15 * 60_000;
const IDLE_MS = 5 * 60_000;

/** Chrome, Chromium or Edge where they usually are; APX_CHROME (config) wins. */
export function findChrome(configured?: string): string | undefined {
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
  // A page check listens to its own tab's events.
  const listeners = new Map<string, (m: Message) => void>();
  let lastUse = Date.now();

  const info = (t: Tab): TabInfo => ({ tab: t.id, url: t.url, title: t.title, profile: t.profile, control: t.control });
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
    if (m.method === "Page.loadEventFired") loads.get(tab.id)?.();
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
        tabs.clear();
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
      tabs.clear();
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

  function stop() {
    proc?.kill();
    proc = undefined;
    pipe = undefined;
    tabs.clear();
    contexts.clear();
  }

  const sweep = setInterval(() => {
    if (deps.remote?.keepAlive?.()) return;
    const now = Date.now();
    for (const t of [...tabs.values()])
      if (now - t.used > TAB_IDLE_MS && !holds.held(t.id)) void close(t.id).catch(() => {});
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

  async function settle(t: Tab): Promise<void> {
    await new Promise<void>((resolve) => {
      const timer = setTimeout(done, NAV_TIMEOUT_MS);
      function done() {
        clearTimeout(timer);
        loads.delete(t.id);
        resolve();
      }
      loads.set(t.id, done);
    });
    await refresh(t);
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
    const t: Tab = {
      id: `${deps.remote ? "vm-" : "h"}${++seq}`,
      target: targetId,
      session: sessionId,
      profile,
      page: new CdpPage(send, {
        selectAllModifiers: deps.remote?.selectAllModifiers ?? (process.platform === "darwin" ? 4 : 2),
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
    await pipe?.send("Target.closeTarget", { targetId: t.target }).catch(() => {});
    changed();
  }

  function get(id: string): Tab {
    const t = tabs.get(id);
    if (!t) throw new ApxError({ code: "not_found", message: `no tab ${id}` });
    t.used = Date.now();
    return t;
  }

  /** The agent drives the tab; another agent's tab is refused (the core checks too). */
  function drive(id: string, by: string): Tab {
    const t = get(id);
    if (t.control.kind === "agent" && t.control.by !== by)
      throw new ApxError({ code: "paused_by_user", message: `tab ${id} is in use by ${t.control.by}` });
    t.control = { kind: "agent", by, since: new Date().toISOString() };
    return t;
  }

  const noHuman = () =>
    new ApxError({
      code: "unavailable",
      message: "this is APX's headless browser: nobody can take over here. Ask the owner to open the APX app for that.",
    });

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
      const p = await ready();
      return runPageCheck(
        {
          send: (method, params, session) => p.send(method, params ?? {}, session),
          listen: (session, fn) => {
            listeners.set(session, fn);
            return () => listeners.delete(session);
          },
        },
        html,
        onCall,
      );
    },
    async handle(method: string, raw: unknown): Promise<unknown> {
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
          const t = get(p.tab);
          const snap = await t.page.snapshot(p.max_chars);
          // Page text is data, never instructions, wherever it ends up (rule 10).
          const tree = `<untrusted_web source="${t.url}">\n${snap.tree}\n</untrusted_web>`;
          return { url: t.url, title: t.title, tree, refs: snap.refs, truncated: snap.truncated };
        }
        case "browser.click": {
          const p = browserMethods["browser.click"].params.parse(raw);
          const t = drive(p.tab, p.by);
          await t.page.click(p.ref);
          await Promise.race([settle(t), new Promise((r) => setTimeout(r, 1500))]);
          await refresh(t);
          return { ok: true, url: t.url };
        }
        case "browser.type": {
          const p = browserMethods["browser.type"].params.parse(raw);
          const t = drive(p.tab, p.by);
          await t.page.type(p.ref, p.text, p.submit);
          if (p.submit) await Promise.race([settle(t), new Promise((r) => setTimeout(r, 2000))]);
          await refresh(t);
          return { ok: true, url: t.url };
        }
        case "browser.screenshot": {
          const p = browserMethods["browser.screenshot"].params.parse(raw);
          const data = await get(p.tab).page.screenshot();
          return { mime: "image/jpeg", data, bytes: Buffer.byteLength(data, "base64") };
        }
        case "browser.text": {
          const p = browserMethods["browser.text"].params.parse(raw);
          const t = get(p.tab);
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
          const text = String(r.result.value ?? "").replace(/\n{3,}/g, "\n\n");
          const slice = text.slice(p.offset, p.offset + p.max_chars);
          return { url: t.url, text: slice, total: text.length, truncated: p.offset + p.max_chars < text.length };
        }
        case "browser.control": {
          const p = browserMethods["browser.control"].params.parse(raw);
          const t = get(p.tab);
          if (p.mode === "user") throw noHuman();
          t.control = { kind: "idle" };
          changed();
          return info(t);
        }
        case "browser.handoff":
          throw noHuman();
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
    },
  };
}

export type HeadlessBrowser = ReturnType<typeof createHeadlessBrowser>;
