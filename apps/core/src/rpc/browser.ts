import { BROWSER_CAP, BROWSER_HOLD, BROWSER_METHODS, type BrowserMethod, type TabInfo } from "@apx/protocol";
import type { Bus } from "../bus.ts";
import { TERMINAL } from "../domain/runs.ts";
import type { Store } from "../domain/store.ts";
import type { Computer } from "../environments/computer.ts";
import { conflict, unauthorized, unavailable } from "../errors.ts";
import type { NodeBroker } from "../nodes/broker.ts";
import { bindBrowserEpoch, browserEpochBackend, unbindBrowserEpoch } from "../nodes/browser-consent-binding.ts";
import { browserConsentCurrent, reconcileBrowserConsents } from "../nodes/browser-consent-reconcile.ts";
import { createBrowserHolds } from "../nodes/browser-holds.ts";
import type { HeadlessBrowser } from "../nodes/headless-browser.ts";
import type { Handler } from "./router.ts";

// Under the client's 15s default so the caller gets our typed timeout, not its own.
const DEADLINE_MS = 12_000;
const HOLD_MS = 5_000;

function deadlineFor(method: BrowserMethod, params: unknown): number {
  // A handoff waits for the human: its deadline is the timeout they were given, plus a margin.
  if (method === "browser.handoff") return ((params as { timeout_s?: number }).timeout_s ?? 300) * 1000 + 10_000;
  // Chromium imports wait on the macOS Keychain dialog.
  if (method === "browser.import_cookies") return 120_000;
  return DEADLINE_MS;
}

/**
 * Every browser.* method is executed by the desktop node when one is connected; with none, by the core's own headless
 * browser (when there is one); the core only routes.
 */
export function browserHandlers(
  broker: NodeBroker,
  headless?: HeadlessBrowser,
  bus?: Bus,
  vm?: Computer,
  store?: Store,
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
  // With no browser at all there are no tabs: an empty list, not an error the panel would log on every load.
  const tabs = handlers["browser.tabs"];
  handlers["browser.tabs"] = (params, ctx) =>
    (ctx.agent && store?.settings.read("computer_chats").includes(ctx.agent.thread_id)) ||
    broker.withCap(BROWSER_CAP) ||
    headless?.running()
      ? tabs(params, ctx)
      : { tabs: [] };
  return handlers;
}
