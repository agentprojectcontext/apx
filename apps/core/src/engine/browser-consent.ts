import type { ApprovalScope } from "@apx/protocol";
import type { ApprovalTarget } from "../domain/approvals.ts";
import type { Store } from "../domain/store.ts";

/** A response approves the displayed context, not whatever a browser became while the card was open. */
export async function prepareBrowserConsent(o: {
  store: Store;
  target: ApprovalTarget;
  scope: ApprovalScope | undefined;
  version: number | undefined;
  thread: string;
  agent: string;
  signal: AbortSignal;
  current(): Promise<ApprovalTarget | undefined>;
}): Promise<boolean> {
  const before = o.target.browser;
  const after = (await o.current())?.browser;
  o.signal.throwIfAborted();
  if (
    !before ||
    !after ||
    before.epoch !== after.epoch ||
    before.tab !== after.tab ||
    before.origin !== after.origin ||
    before.run !== after.run
  )
    throw new Error("Browser approval context changed while waiting; inspect the tab and request approval again");
  if (o.store.approvals.browserVersion(o.target, o.thread, o.agent) !== o.version)
    throw new Error("Browser approval was revoked or declined while waiting; request approval again");
  return o.scope === "tab" || o.scope === "turn";
}
