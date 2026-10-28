import type { TabInfo } from "@apx/protocol";
import type { BrowserConsentContext } from "../domain/browser-consents.ts";
import type { Store } from "../domain/store.ts";
import { bindBrowserEpoch, browserEpochBackend } from "./browser-consent-binding.ts";

/** A lifecycle event can precede the response that would activate the first tab consent. */
export function browserConsentCurrent(
  context: BrowserConsentContext,
  agent: string | undefined,
  backend: string,
  tabs?: readonly TabInfo[],
): boolean {
  const source = browserEpochBackend(context.epoch);
  if (source !== backend) return false;
  // Without an event since attachment, the host's successful execution proves the initial identity.
  if (!tabs) return !backend.startsWith("vm:");
  const tab = tabs.find((item) => item.tab === context.tab);
  let origin: string | undefined;
  try {
    origin = new URL(tab?.url ?? "").origin;
  } catch {}
  return !!(
    origin === context.origin &&
    tab?.consent_epoch &&
    context.epoch === bindBrowserEpoch(backend, tab.consent_epoch) &&
    (tab.control.kind === "idle" || (tab.control.kind === "agent" && tab.control.by === agent))
  );
}

/** Browser events retire stale tab grants as well as refusing their use at the execution boundary. */
export function reconcileBrowserConsents(
  store: { approvals: Pick<Store["approvals"], "list" | "revoke"> },
  backend: string,
  tabs: readonly TabInfo[],
): void {
  for (const grant of store.approvals.list()) {
    if (grant.scope !== "tab" || !grant.browser) continue;
    const source = browserEpochBackend(grant.browser.epoch);
    if (backend.startsWith("vm:") ? source !== backend : source?.startsWith("vm:")) continue;
    if (!browserConsentCurrent(grant.browser, grant.agent_id, backend, tabs))
      store.approvals.revoke(grant.key, grant.thread_id, grant.agent_id);
  }
}
