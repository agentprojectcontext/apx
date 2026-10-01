// Owns the tabs. Executes browser.* for the core and for the user's own chrome (URL bar, take control).
// The node re-checks control on every agent call: it never trusts that the core already did.
import { EventEmitter } from "node:events";
import { type BrowserProfile, browserMethods, type TabControl, type TabInfo } from "@apx/protocol";
import { ApxError } from "@apx/protocol/client";
import { app, type Session, session, WebContentsView } from "electron";
import { CdpTab } from "./cdp.ts";
import { discoverSources, importCookies, listDomains } from "./cookies.ts";

type Tab = { id: string; profile: BrowserProfile; view: WebContentsView; cdp: CdpTab; control: TabControl };

const MAX_TABS = 8;
const NAV_TIMEOUT_MS = 8_000;

/** The honest Chromium UA: no "Electron/x" or app token. Client hints stay untouched (removing them breaks Google login). */
function cleanUserAgent(): string {
  return app.userAgentFallback.replace(/\sElectron\/\S+/, "").replace(/\s@?apx[^\s]*\/\S+/i, "");
}

function partitionFor(profile: BrowserProfile, seq: number): string {
  if (profile === "shared") return "persist:apx-shared";
  if (profile === "incognito") return `apx-incog-${seq}`; // no "persist:" → memory only
  return `persist:apx-agent-${profile.slice("agent:".length)}`;
}

const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]", "0.0.0.0"]);
let blockedPorts = new Set<string>();

/** APX's own core and panel must never load inside a tab: a driven tab would hold the owner's controls. */
export function blockAppOrigins(urls: string[]): void {
  blockedPorts = new Set(urls.map((u) => new URL(u).port || "80"));
}

export function assertNavigable(url: string): void {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new ApxError({ code: "bad_request", message: `not a URL: ${url}` });
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new ApxError({ code: "bad_request", message: `navigation blocked: only http(s), got ${u.protocol}` });
  }
  if (u.username || u.password)
    throw new ApxError({ code: "bad_request", message: "navigation blocked: credentials in URL" });
  if (LOOPBACK.has(u.hostname) && blockedPorts.has(u.port || "80")) {
    throw new ApxError({ code: "bad_request", message: "navigation blocked: that is APX itself" });
  }
  if (/^169\.254\./.test(u.hostname) || u.hostname === "metadata.google.internal") {
    throw new ApxError({ code: "bad_request", message: "navigation blocked: link-local/metadata address" });
  }
}

export class BrowserHost extends EventEmitter<{ changed: [] }> {
  #tabs = new Map<string, Tab>();
  #active: string | undefined;
  #seq = 0;
  #configured = new WeakSet<Session>();
  #handoffs = new Map<string, (ok: boolean) => void>();
  /** Called when a tab needs the human (handoff): the window should come forward and notify. */
  onAttention: (message: string) => void = () => {};
  /** Called whenever the visible tab changes, so the window can lay it out. */
  onShow: (view: WebContentsView | undefined) => void = () => {};

  get active(): string | undefined {
    return this.#active;
  }

  info(tab: Tab): TabInfo {
    const wc = tab.view.webContents;
    return { tab: tab.id, url: wc.getURL(), title: wc.getTitle(), profile: tab.profile, control: tab.control };
  }

  list(): TabInfo[] {
    return [...this.#tabs.values()].map((t) => this.info(t));
  }

  /** Executes a browser.* request coming from the core. Params are re-validated: the node trusts nobody. */
  async handle(method: string, raw: unknown): Promise<unknown> {
    switch (method) {
      case "browser.tabs":
        return { tabs: this.list() };
      case "browser.open": {
        const p = browserMethods["browser.open"].params.parse(raw);
        const tab = await this.open(p.url, p.profile, { kind: "agent", by: p.by, since: new Date().toISOString() });
        return this.info(tab);
      }
      case "browser.navigate": {
        const p = browserMethods["browser.navigate"].params.parse(raw);
        const tab = this.#drive(p.tab, p.by);
        await this.#load(tab, p.url);
        return { url: tab.view.webContents.getURL(), title: tab.view.webContents.getTitle() };
      }
      case "browser.snapshot": {
        const p = browserMethods["browser.snapshot"].params.parse(raw);
        const tab = this.#readable(p.tab);
        const wc = tab.view.webContents;
        const snap = await tab.cdp.snapshot(p.max_chars);
        // Page text is data, never instructions, wherever it ends up (rule 10).
        const tree = `<untrusted_web source="${wc.getURL()}">\n${snap.tree}\n</untrusted_web>`;
        return { url: wc.getURL(), title: wc.getTitle(), tree, refs: snap.refs, truncated: snap.truncated };
      }
      case "browser.click": {
        const p = browserMethods["browser.click"].params.parse(raw);
        const tab = this.#drive(p.tab, p.by);
        await tab.cdp.click(p.ref);
        await this.#settle(tab);
        return { ok: true, url: tab.view.webContents.getURL() };
      }
      case "browser.type": {
        const p = browserMethods["browser.type"].params.parse(raw);
        const tab = this.#drive(p.tab, p.by);
        await tab.cdp.type(p.ref, p.text, p.submit);
        if (p.submit) await this.#settle(tab);
        return { ok: true, url: tab.view.webContents.getURL() };
      }
      case "browser.screenshot": {
        const p = browserMethods["browser.screenshot"].params.parse(raw);
        const jpeg = await this.#get(p.tab).cdp.screenshot();
        return { mime: "image/jpeg", data: jpeg.toString("base64"), bytes: jpeg.length };
      }
      case "browser.text": {
        const p = browserMethods["browser.text"].params.parse(raw);
        const wc = this.#readable(p.tab).view.webContents;
        // Isolated world: the page's scripts cannot see or patch this read.
        const [full] = (await wc.executeJavaScriptInIsolatedWorld(999, [
          { code: "document.body ? document.body.innerText : ''" },
        ])) as [string];
        const text = String(full ?? "").replace(/\n{3,}/g, "\n\n");
        const slice = text.slice(p.offset, p.offset + p.max_chars);
        return { url: wc.getURL(), text: slice, total: text.length, truncated: p.offset + p.max_chars < text.length };
      }
      case "browser.control": {
        const p = browserMethods["browser.control"].params.parse(raw);
        if (p.mode === "user") this.takeControl(p.tab);
        else this.giveBack(p.tab, p.mode === "done");
        // Let a resumed handoff settle its new control state before reporting it.
        await new Promise((r) => setImmediate(r));
        return this.info(this.#get(p.tab));
      }
      case "browser.handoff": {
        const p = browserMethods["browser.handoff"].params.parse(raw);
        const tab = this.#get(p.tab);
        if (tab.control.kind === "handoff" || this.#handoffs.has(tab.id)) {
          throw new ApxError({ code: "paused_by_user", message: "this tab is already waiting for the human" });
        }
        tab.control = { kind: "handoff", by: p.by, reason: p.reason, since: new Date().toISOString() };
        this.select(tab.id);
        this.onAttention(`${p.by} necesita que ${p.reason}`);
        this.emit("changed");
        const resolved = await new Promise<boolean>((resolve) => {
          const waiter = (ok: boolean) => {
            clearTimeout(timer);
            if (this.#handoffs.get(tab.id) === waiter) this.#handoffs.delete(tab.id);
            resolve(ok);
          };
          const timer = setTimeout(() => waiter(false), p.timeout_s * 1000);
          this.#handoffs.set(tab.id, waiter);
        });
        if (!this.#tabs.has(tab.id)) return { resolved: false, url: "", title: "" };
        tab.control = resolved ? { kind: "agent", by: p.by, since: new Date().toISOString() } : { kind: "idle" };
        this.emit("changed");
        return { resolved, url: tab.view.webContents.getURL(), title: tab.view.webContents.getTitle() };
      }
      case "browser.cookie_sources":
        return {
          sources: discoverSources().map(({ id, browser, profile, family }) => ({ id, browser, profile, family })),
        };
      case "browser.cookie_domains": {
        const p = browserMethods["browser.cookie_domains"].params.parse(raw);
        return { domains: (await listDomains(this.#source(p.source), p.filter)).slice(0, 200) };
      }
      case "browser.import_cookies": {
        const p = browserMethods["browser.import_cookies"].params.parse(raw);
        const ses = session.fromPartition(partitionFor(p.profile, 0));
        this.#configure(ses);
        return importCookies(this.#source(p.source), p.domains, ses);
      }
      case "browser.close": {
        const p = browserMethods["browser.close"].params.parse(raw);
        await this.close(p.tab);
        return { ok: true };
      }
      default:
        throw new ApxError({ code: "unknown_method", message: `browser node does not serve ${method}` });
    }
  }

  async open(url: string, profile: BrowserProfile, control: TabControl): Promise<Tab> {
    assertNavigable(url);
    if (this.#tabs.size >= MAX_TABS)
      throw new ApxError({ code: "unavailable", message: `tab limit (${MAX_TABS}) reached` });
    const id = `t${++this.#seq}`;
    const ses = session.fromPartition(partitionFor(profile, this.#seq));
    this.#configure(ses);
    const view = new WebContentsView({
      webPreferences: {
        session: ses,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false,
      },
    });
    const wc = view.webContents;
    // Popups stay in the same tab and keep the same owner/profile.
    wc.setWindowOpenHandler(({ url: next }) => {
      try {
        assertNavigable(next);
        void wc.loadURL(next);
      } catch {}
      return { action: "deny" };
    });
    // Same guard for clicks, redirects and subframes: a redirect must not reach what a direct load cannot.
    const guard = (e: { preventDefault(): void }, next: string) => {
      try {
        assertNavigable(next);
      } catch {
        e.preventDefault();
      }
    };
    wc.on("will-navigate", (e) => guard(e, e.url));
    wc.on("will-redirect", (e) => guard(e, e.url));
    wc.on("will-frame-navigate", (e) => guard(e, e.url));
    for (const ev of ["did-navigate", "did-navigate-in-page", "page-title-updated", "did-stop-loading"] as const) {
      wc.on(ev as "did-stop-loading", () => this.emit("changed"));
    }
    const cdp = new CdpTab(wc);
    const tab: Tab = { id, profile, view, cdp, control };
    this.#tabs.set(id, tab);
    this.select(id);
    await this.#load(tab, url);
    // CDP domains only answer once the tab has a renderer. See HISTORY.md#cdp-attach-after-load
    await cdp.attach();
    return tab;
  }

  select(id: string): void {
    const tab = this.#get(id);
    this.#active = id;
    this.onShow(tab.view);
    this.emit("changed");
  }

  async close(id: string): Promise<void> {
    const tab = this.#get(id);
    this.#tabs.delete(id);
    this.#handoffs.get(id)?.(false);
    const ses = tab.view.webContents.session;
    tab.view.webContents.close();
    // In-memory partitions live until app exit unless cleared.
    if (tab.profile === "incognito") await Promise.all([ses.clearStorageData(), ses.clearCache()]);
    if (this.#active === id) {
      this.#active = [...this.#tabs.keys()].at(-1);
      this.onShow(this.#active ? this.#get(this.#active).view : undefined);
    }
    this.emit("changed");
  }

  /** The human takes the wheel: every agent call on this tab now fails with paused_by_user. */
  takeControl(id: string): void {
    this.#get(id).control = { kind: "user", since: new Date().toISOString() };
    this.emit("changed");
  }

  /** `done` finishes a pending handoff (the agent resumes); `idle` ends it as not done. */
  giveBack(id: string, done = false): void {
    const tab = this.#get(id);
    const waiter = this.#handoffs.get(id);
    if (waiter) {
      waiter(done);
      return;
    }
    tab.control = { kind: "idle" };
    this.emit("changed");
  }

  async userNavigate(id: string, url: string): Promise<void> {
    const tab = this.#get(id);
    await this.#load(tab, /^https?:\/\//.test(url) ? url : `https://${url}`);
  }

  #source(id: string) {
    const src = discoverSources().find((s) => s.id === id);
    if (!src) throw new ApxError({ code: "bad_request", message: `unknown cookie source ${id}` });
    return src;
  }

  /** Reading page content while the human has the tab could expose what they type (codes, card data). */
  #readable(id: string): Tab {
    const tab = this.#get(id);
    if (tab.control.kind === "user" || tab.control.kind === "handoff") {
      throw new ApxError({ code: "paused_by_user", message: "the human has this tab right now; wait for them" });
    }
    return tab;
  }

  #get(id: string): Tab {
    const tab = this.#tabs.get(id);
    if (!tab) throw new ApxError({ code: "bad_request", message: `unknown tab ${id}` });
    return tab;
  }

  #drive(id: string, by: string): Tab {
    const tab = this.#get(id);
    if (tab.control.kind === "user" || tab.control.kind === "handoff") {
      throw new ApxError({ code: "paused_by_user", message: "the human has this tab right now; wait or ask them" });
    }
    if (tab.control.kind !== "agent" || tab.control.by !== by) {
      tab.control = { kind: "agent", by, since: new Date().toISOString() };
      this.emit("changed");
    }
    return tab;
  }

  /** Resolves at dom-ready (usable page), not at full load: ads and trackers must not hold the agent hostage. */
  async #load(tab: Tab, url: string): Promise<void> {
    assertNavigable(url);
    const wc = tab.view.webContents;
    const ready = new Promise<void>((resolve) => {
      const done = () => {
        wc.off("dom-ready", done);
        wc.off("did-fail-load", done);
        resolve();
      };
      wc.on("dom-ready", done);
      wc.on("did-fail-load", done);
    });
    // Redirects reject loadURL with ERR_ABORTED although the page loads: not an error for us.
    wc.loadURL(url).catch(() => {});
    await Promise.race([ready, new Promise<void>((resolve) => setTimeout(resolve, NAV_TIMEOUT_MS))]);
  }

  /** After an action that may navigate: give it a beat, then wait for loading to stop (bounded). */
  async #settle(tab: Tab): Promise<void> {
    await new Promise((r) => setTimeout(r, 250));
    const wc = tab.view.webContents;
    if (!wc.isLoading()) return;
    await Promise.race([
      new Promise<void>((resolve) => wc.once("did-stop-loading", () => resolve())),
      new Promise<void>((resolve) => setTimeout(resolve, NAV_TIMEOUT_MS)),
    ]);
  }

  #configure(ses: Session): void {
    if (this.#configured.has(ses)) return;
    this.#configured.add(ses);
    ses.setUserAgent(cleanUserAgent());
    // Camera, mic, geolocation, notifications, clipboard-read: denied unless a later UI grants them.
    ses.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
    ses.on("will-download", (e) => e.preventDefault());
  }
}
