import type { Store } from "../domain/store.ts";
import { mcpServerApproval, serverApprovalId } from "./approval.ts";
import type { McpDef } from "./config.ts";

/** Who allowed every tool: the owner, or APX's open default for a new server (DECISIONS.md#d-279). */
export type OpenedBy = "owner" | "default";

/** Owner-wide grants leave per-agent and per-chat grants alone. */
export function setMcpToolMode(
  store: Store,
  d: McpDef,
  mode: "ask" | "all",
  by: OpenedBy = "owner",
  known: readonly { key: string }[] = [],
): void {
  const server = mcpServerApproval(d);
  if (mode === "all") {
    store.approvals.grant({ ...server, ...(by === "default" ? { byDefault: true as const } : {}) }, "always", "");
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
        (g.credential_scope !== undefined
          ? g.credential_scope === server.credential_scope
          : g.key === server.key || known.some((t) => t.key === g.key)),
    );
  for (const g of ownerWide) store.approvals.revoke(g.key);
}

type ServerId = Pick<McpDef, "scope" | "project_id" | "name">;

/** Who gave the server an owner-wide "allow all", under this definition or an edit's old one; none: undefined. */
export function allowsAll(store: Store, d: McpDef): OpenedBy | undefined {
  const target = mcpServerApproval(d);
  const all = store.approvals
    .list()
    .filter(
      (g) =>
        g.server === target.server &&
        g.tool === "*" &&
        g.scope === "always" &&
        !g.agent_id &&
        !g.thread_id &&
        (g.key === target.key ||
          g.credential_scope === target.credential_scope ||
          (g.credential_scope === undefined && !d.values_of && g.project_id === d.project_id)),
    );
  if (!all.length) return undefined;
  return all.some((g) => !g.by_default) ? "owner" : "default";
}

const openedKey = (d: ServerId) => `mcp_opened:${serverApprovalId(d)}`;

/**
 * Allow all once per server: a later "ask" or pick by the owner is never undone by a restart or a re-enable. `again`
 * opens it anyway, as `by` says (an edit keeps who allowed it); a server the owner had allowed comes back as theirs.
 */
export function openNew(store: Store, d: McpDef, again = false, by: OpenedBy = "default"): void {
  const mark = store.settings.get(openedKey(d));
  if (!again && mark === "1") return;
  setMcpToolMode(store, d, "all", !again && mark === "owner" ? "owner" : by);
  store.settings.set(openedKey(d), "1");
}

/** New again when it comes back; `by` "owner": it comes back allowed as the owner's own choice. */
export function forgetOpened(store: Store, d: ServerId, by?: OpenedBy): void {
  if (by === "owner") store.settings.set(openedKey(d), "owner");
  else if (store.settings.get(openedKey(d)) !== undefined) store.settings.set(openedKey(d), "");
}
