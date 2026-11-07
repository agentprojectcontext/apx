import {
  BROWSER_CAP,
  BROWSER_FILL_SECRET,
  BROWSER_HOLD,
  BROWSER_METHODS,
  type BrowserMethod,
  CHROME_CAP,
  chromeTabId,
  siteOrigin,
  type TabInfo,
} from "@apx/protocol";
import type { Bus } from "../bus.ts";
import { inChrome, ownerAsked, TERMINAL } from "../domain/runs.ts";
import type { Store } from "../domain/store.ts";
import type { Computer } from "../environments/computer.ts";
import { conflict, unauthorized, unavailable } from "../errors.ts";
import type { NodeBroker } from "../nodes/broker.ts";
import { bindBrowserEpoch, browserEpochBackend, unbindBrowserEpoch } from "../nodes/browser-consent-binding.ts";
import { browserConsentCurrent, reconcileBrowserConsents } from "../nodes/browser-consent-reconcile.ts";
import { createBrowserHolds } from "../nodes/browser-holds.ts";
import type { ChromeOpen } from "../nodes/chrome-launch.ts";
import type { HeadlessBrowser } from "../nodes/headless-browser.ts";
import { type SignInDeps, signInHandler } from "./browser-sign-in.ts";
import type { Handler } from "./router.ts";

// Under the client's 15s default so the caller gets our typed timeout, not its own.
const DEADLINE_MS = 12_000;
const HOLD_MS = 5_000;
// The extension reconnecting (its worker restarted) is back within a moment; a browser just opened takes longer.
const CHROME_GRACE_MS = 2_000;
const CHROME_START_MS = 12_000;

/** How the core gets the owner's Chrome when a turn asks for it and it is not connected. */
export type OwnersChrome = {
  open(): Promise<ChromeOpen>;
  /** Tests shorten the waits; by default CHROME_GRACE_MS and CHROME_START_MS. */
  graceMs?: number;
  startMs?: number;
};

function deadlineFor(method: BrowserMethod, params: unknown): number {
  // A handoff waits for the human: its deadline is the timeout they were given, plus a margin.
  if (method === "browser.handoff") return ((params as { timeout_s?: number }).timeout_s ?? 300) * 1000 + 10_000;
  // Chromium imports wait on the macOS Keychain dialog.
  if (method === "browser.import_cookies") return 120_000;
  return DEADLINE_MS;
}

/**
 * Every browser.* method is executed by the desktop node when one is connected; with none, by the core's own headless
 * browser (when there is one); a turn the owner started from APX's panel in Chrome, by their Chrome. The core only
 * routes.
 */
export function browserHandlers(
  broker: NodeBroker,
  headless?: HeadlessBrowser,
  bus?: Bus,
  vm?: Computer,
  store?: Store,
  signIn?: Omit<SignInDeps, "store" | "tabOrigin" | "fill">,
  ownersChrome?: OwnersChrome,
) {
  const local = () => !broker.withCap(BROWSER_CAP) && headless?.available();
  // A tab an agent's turn uses stays open (not closed for being idle) until that turn ends.
  const holds = createBrowserHolds(() => {
    if (local())
      return headless && { key: "headless", send: (run, tabs) => headless.handle(BROWSER_HOLD, { run, tabs }) };
    const node = broker.withCap(BROWSER_CAP);
    return (
      node && {
        key: node.session,
        send: (run, tabs) => broker.invoke(BROWSER_CAP, BROWSER_HOLD, { run, tabs }, HOLD_MS),
      }
    );
  });
  const backend = () => (local() ? "headless" : (broker.withCap(BROWSER_CAP)?.session ?? "unavailable"));
  type Ctx = Parameters<Handler<"browser.tabs">>[1];
  const askedIn = (id: string) => store?.runs.get(store.inputs.get(id)?.run_id ?? "")?.input?.origin;
  const runOf = (ctx: Ctx) => (ctx.agent ? store?.runs.get(ctx.agent.run_id) : undefined);
  /** An agent's call in a turn written in APX's panel in Chrome: all of its browsing is in the owner's Chrome. */
  const chromeTurn = (ctx: Ctx): boolean => inChrome(runOf(ctx)?.input?.origin, askedIn);
  /** The owner's own turn (their words, or their answer in a turn they asked for): it may also use their Chrome. */
  const ownersTurn = (ctx: Ctx): boolean => ownerAsked(runOf(ctx)?.input?.origin, askedIn);
  /** A call for the owner's Chrome in any other turn: a tab of theirs, or a new one asked for there. */
  const forChrome = (method: BrowserMethod, params: unknown): boolean =>
    method === "browser.open"
      ? (params as { chrome?: unknown }).chrome === true
      : chromeTabId(String((params as { tab?: unknown }).tab ?? "")) !== undefined;
  /** Whether the owner's Chrome is connected within `ms`: decided by its connection, the wait only bounds it. */
  const chromeWithin = (ms: number) =>
    new Promise<boolean>((resolve) => {
      if (broker.withCap(CHROME_CAP)) return resolve(true);
      const done = (ok: boolean) => {
        clearTimeout(timer);
        stop();
        resolve(ok);
      };
      const stop = broker.onConnectionChange(() => {
        if (broker.withCap(CHROME_CAP)) done(true);
      });
      const timer = setTimeout(() => done(false), ms);
    });
  /** Opening a tab with Chrome closed starts Chrome first; its extension connects by itself once it runs. */
  const reachChrome = async (method: BrowserMethod) => {
    if (await chromeWithin(ownersChrome?.graceMs ?? CHROME_GRACE_MS)) return;
    if (method !== "browser.open" || !ownersChrome)
      throw unavailable(
        "the owner's Chrome is not connected: ask them to open Chrome (APX's extension must be on there)",
      );
    const opened = await ownersChrome.open().catch((): ChromeOpen => "failed");
    if (opened === "no_extension")
      throw unavailable("APX's extension is not installed in the owner's Chrome: ask them to add it, then try again");
    if (opened === "failed")
      throw unavailable("the owner's Chrome is closed and APX could not open it: ask them to open Chrome");
    if (!(await chromeWithin(ownersChrome.startMs ?? CHROME_START_MS)))
      throw unavailable(
        "APX opened the owner's Chrome but its APX extension did not connect: ask them to check it is turned on there",
      );
  };
  const inOwnersChrome = async (method: BrowserMethod, params: unknown) => {
    await reachChrome(method);
    return broker.invoke(CHROME_CAP, method, params, deadlineFor(method, params));
  };
  let connection = backend();
  let observedTabs: readonly TabInfo[] | undefined;
  store?.approvals.setBrowserConsentGuard((context, agent) => {
    const source = browserEpochBackend(context.epoch);
    if (source?.startsWith("vm:")) {
      const state = vm?.browserConsentState(context.run);
      return !!(
        source === `vm:${context.run}` &&
        state?.agent === agent &&
        browserConsentCurrent(context, agent, source, state.tabs)
      );
    }
    return browserConsentCurrent(context, agent, backend(), observedTabs);
  });
  vm?.onBrowserChange((run, tabs) => {
    if (store) reconcileBrowserConsents(store, `vm:${run}`, tabs);
  });
  broker.onConnectionChange(() => {
    const next = backend();
    if (next !== connection) {
      observedTabs = undefined;
      if (store) reconcileBrowserConsents(store, next, []);
    }
    connection = next;
  });
  bus?.on((e) => {
    if (e.type === "run.updated" && TERMINAL.has(e.run.state)) {
      holds.end(e.run.id);
      for (const grant of store?.approvals.list() ?? [])
        if (grant.browser?.run === e.run.id && browserEpochBackend(grant.browser.epoch)?.startsWith("vm:"))
          store?.approvals.revoke(grant.key, grant.thread_id, grant.agent_id);
    }
    if (e.type === "browser.tabs" && store) {
      observedTabs = e.tabs;
      reconcileBrowserConsents(store, backend(), e.tabs);
    }
  });
  const invokeBound = async (
    method: BrowserMethod,
    params: unknown,
    backend: string,
    invoke: (params: unknown) => Promise<unknown>,
  ) => {
    const epoch = (params as { epoch?: string }).epoch;
    const bound =
      method === "browser.evaluate" && epoch !== undefined
        ? { ...(params as object), epoch: unbindBrowserEpoch(backend, epoch) }
        : params;
    const out = await invoke(bound);
    return method === "browser.approval_context"
      ? { epoch: bindBrowserEpoch(backend, (out as { epoch: string }).epoch) }
      : out;
  };
  const forward =
    (method: BrowserMethod): Handler<BrowserMethod> =>
    async (params, ctx) => {
      const thread = ctx.agent?.thread_id;
      if (thread && store?.settings.read("computer_chats").includes(thread)) {
        if (!vm?.hasThread(thread)) throw unavailable("VM browser unavailable; host browser refused");
        const run = ctx.agent && store.runs.get(ctx.agent.run_id);
        if (run?.state !== "working" || run.thread_id !== thread || run.agent_id !== ctx.agent?.id)
          throw conflict("VM browser does not belong to this active run");
        // Checked on every call: the owner may take the permission away while the turn runs.
        if (!vm.permitted(run.agent_id, thread)) throw unauthorized("this agent may not use the computer");
        return (await invokeBound(method, params, `vm:${run.id}`, (bound) =>
          vm.browser(run.id).handle(method, bound),
        )) as never;
      }
      // The owner's own tabs: nothing is held or bound here, their Chrome closes nothing for being idle.
      if (chromeTurn(ctx)) return (await inOwnersChrome(method, params)) as never;
      if (forChrome(method, params)) {
        // A contact's words, a routine or another agent never reach the owner's signed-in Chrome.
        if (ctx.agent && !ownersTurn(ctx)) throw unauthorized("only a turn the owner asked for may use their Chrome");
        return (await inOwnersChrome(method, params)) as never;
      }
      const isLocal = local();
      const backend = isLocal ? "headless" : (broker.withCap(BROWSER_CAP)?.session ?? "unavailable");
      const out = await invokeBound(method, params, backend, async (bound) =>
        isLocal
          ? headless?.handle(method, bound)
          : broker.invoke(BROWSER_CAP, method, bound, deadlineFor(method, bound)),
      );
      const tab =
        (params as { tab?: unknown }).tab ?? (method === "browser.open" ? (out as { tab?: unknown }).tab : undefined);
      if (ctx.agent && method !== "browser.close" && typeof tab === "string") holds.hold(ctx.agent.run_id, tab);
      return out as never;
    };
  const handlers = Object.fromEntries(BROWSER_METHODS.map((m) => [m, forward(m)])) as {
    [M in BrowserMethod]: Handler<M>;
  };
  if (signIn && store) {
    const tabsOf = (ctx: Parameters<Handler<"browser.tabs">>[1]) => handlers["browser.tabs"]({}, ctx);
    handlers["browser.sign_in"] = signInHandler({
      ...signIn,
      store,
      tabOrigin: async (tab, ctx) => siteOrigin((await tabsOf(ctx)).tabs.find((t) => t.tab === tab)?.url ?? "") ?? "",
      async fill(params, ctx) {
        // The isolated computer's browser is another machine: a stored secret never goes there.
        if (ctx.agent && store.settings.read("computer_chats").includes(ctx.agent.thread_id))
          throw unavailable("signing in with a stored secret works only in the owner's browser");
        if (chromeTurn(ctx) || chromeTabId(String(params.tab)) !== undefined)
          throw unavailable("in the owner's Chrome they sign in themselves: ask them to, then go on");
        if (local()) return headless?.handle(BROWSER_FILL_SECRET, params);
        const out = await broker.invoke(
          BROWSER_CAP,
          BROWSER_FILL_SECRET,
          params,
          deadlineFor("browser.sign_in", params),
        );
        if (ctx.agent) holds.hold(ctx.agent.run_id, String(params.tab));
        return out;
      },
    });
  }
  // With no browser at all there are no tabs: an empty list, not an error the panel would log on every load.
  const tabs = handlers["browser.tabs"];
  const ownBrowserTabs = (params: Parameters<typeof tabs>[0], ctx: Ctx) =>
    (ctx.agent && store?.settings.read("computer_chats").includes(ctx.agent.thread_id)) ||
    chromeTurn(ctx) ||
    broker.withCap(BROWSER_CAP) ||
    headless?.running()
      ? tabs(params, ctx)
      : { tabs: [] };
  // In the owner's own turn the agent also sees the tabs of their Chrome's APX group, beside APX's browser.
  handlers["browser.tabs"] = async (params, ctx) => {
    const own = await ownBrowserTabs(params, ctx);
    if (!ctx.agent || chromeTurn(ctx) || !ownersTurn(ctx) || !broker.withCap(CHROME_CAP)) return own;
    const chrome = (await inOwnersChrome("browser.tabs", {}).catch(() => ({ tabs: [] }))) as { tabs: TabInfo[] };
    return { tabs: [...own.tabs, ...chrome.tabs] };
  };
  return handlers;
}
