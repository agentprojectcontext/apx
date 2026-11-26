import type { Store } from "../domain/store.ts";
import { mcpServerApproval } from "./approval.ts";
import type { McpDef } from "./config.ts";

/** Owner-wide grants leave per-agent and per-chat grants alone. */
export function setMcpToolMode(store: Store, d: McpDef, mode: "ask" | "all"): void {
  const server = mcpServerApproval(d);
  if (mode === "all") {
    store.approvals.grant(server, "always", "");
    return;
  }
  const ownerWide = store.approvals
    .list()
    .filter(
      (g) =>
        g.server === server.server &&
        g.scope === "always" &&
        !g.agent_id &&
        !g.thread_id &&
        (g.project_id ?? "") === (server.project_id ?? ""),
    );
  for (const g of ownerWide) store.approvals.revoke(g.key);
}
