import { BROWSER_CAP, BROWSER_HOLD, BROWSER_METHODS, type BrowserMethod } from "@apx/protocol";
import type { Bus } from "../bus.ts";
import { TERMINAL } from "../domain/runs.ts";
import type { NodeBroker } from "../nodes/broker.ts";
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
export function browserHandlers(broker: NodeBroker, headless?: HeadlessBrowser, bus?: Bus) {
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
  bus?.on((e) => {
    if (e.type === "run.updated" && TERMINAL.has(e.run.state)) holds.end(e.run.id);
  });
  const forward =
    (method: BrowserMethod): Handler<BrowserMethod> =>
    async (params, ctx) => {
      const out = await (local()
        ? headless?.handle(method, params)
        : broker.invoke(BROWSER_CAP, method, params, deadlineFor(method, params)));
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
    broker.withCap(BROWSER_CAP) || headless?.running() ? tabs(params, ctx) : { tabs: [] };
  return handlers;
}
