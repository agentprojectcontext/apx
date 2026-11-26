import type { Store } from "../domain/store.ts";
import { mcpServerApproval, serverApprovalId } from "./approval.ts";
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

type ServerId = Pick<McpDef, "scope" | "project_id" | "name">;

/** An owner-wide "allow all" for the server, bound to any of its definitions (an edit's old one included). */
export function allowsAll(store: Store, d: ServerId): boolean {
  const id = serverApprovalId(d);
  return store.approvals
    .list()
    .some((g) => g.server === id && g.tool === "*" && g.scope === "always" && !g.agent_id && !g.thread_id);
}

const openedKey = (d: ServerId) => `mcp_opened:${serverApprovalId(d)}`;

/** Allow all once per server: a later "ask" or pick by the owner is never undone by a restart or a re-enable. */
export function openNew(store: Store, d: McpDef, again = false): void {
  if (!again && store.settings.get(openedKey(d)) === "1") return;
  setMcpToolMode(store, d, "all");
  store.settings.set(openedKey(d), "1");
}

export function forgetOpened(store: Store, d: ServerId): void {
  if (store.settings.get(openedKey(d)) !== undefined) store.settings.set(openedKey(d), "");
}
