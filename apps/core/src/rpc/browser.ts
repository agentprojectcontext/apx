import { BROWSER_CAP, BROWSER_METHODS, type BrowserMethod } from "@apx/protocol";
import type { NodeBroker } from "../nodes/broker.ts";
import type { Handler } from "./router.ts";

// Under the client's 15s default so the caller gets our typed timeout, not its own.
const DEADLINE_MS = 12_000;

function deadlineFor(method: BrowserMethod, params: unknown): number {
  // A handoff waits for the human: its deadline is the timeout they were given, plus a margin.
  if (method === "browser.handoff") return ((params as { timeout_s?: number }).timeout_s ?? 300) * 1000 + 10_000;
  return DEADLINE_MS;
}

/** Every browser.* method is executed by the desktop node; the core only routes. */
export function browserHandlers(broker: NodeBroker) {
  const forward =
    (method: BrowserMethod): Handler<BrowserMethod> =>
    (params) =>
      broker.invoke(BROWSER_CAP, method, params, deadlineFor(method, params)) as never;
  return Object.fromEntries(BROWSER_METHODS.map((m) => [m, forward(m)])) as { [M in BrowserMethod]: Handler<M> };
}
