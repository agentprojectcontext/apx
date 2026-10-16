// Owner grants: durable for every agent or for one, or limited to one chat in this core process.
import { createHash } from "node:crypto";
import { type ApprovalScope, STRICT_APPROVAL, ToolApproval } from "@apx/protocol";
import { z } from "zod";
import { settingsRepo } from "./settings.ts";
import type { Sql } from "./sql.ts";

export type ApprovalTarget = {
  key: string;
  server: string;
  tool: string;
  /** Declared read-only: shown as such; any tool can be approved for good, the owner decides. */
  permanent: boolean;
  project_id?: string | undefined;
};
export const approvalScopes = (_a: ApprovalTarget): ApprovalScope[] => ["once", "session", "always"];

/** The server name of APX's own tools in grants (an MCP server's is its approval id). */
export const APX_SERVER = "apx";

/**
 * One of APX's own tools: one key per tool name, so the owner's "always" for an agent covers that tool's calls that
 * would ask. Calls that always ask (a destructive command, a routine or agent change) use `strictApproval`'s key.
 */
export const nativeApproval = (tool: string): ApprovalTarget => ({
  key: `${APX_SERVER}:${tool}`,
  server: APX_SERVER,
  tool,
  permanent: false,
});

/**
 * The grant for a tool's calls that always ask: its own key, so an OK given for the tool's ordinary calls never
 * covers them, and an OK given for them never covers more than they are. DECISIONS.md#d-089
 */
export const strictApproval = (a: ApprovalTarget): ApprovalTarget => ({ ...a, key: `${a.key}${STRICT_APPROVAL}` });

export function approvalsRepo(q: Sql) {
  const settings = settingsRepo(q);
  const listeners = new Set<() => void>();
  const onceSchema = z.array(
    z.object({ key: z.string(), until: z.number(), binding: z.string().optional(), server: z.string().optional() }),
  );
  const onceRead = () => {
    try {
      return onceSchema.parse(JSON.parse(settings.get("tool_once_grants") ?? "[]")).filter((g) => g.until > Date.now());
    } catch {
      return [];
    }
  };
  const canonical = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === "object")
      return Object.fromEntries(
        Object.entries(value)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([k, v]) => [k, canonical(v)]),
      );
    return value;
  };
  const onceKey = (thread: string, agent: string, tool: string, args: unknown, binding?: string) =>
    createHash("sha256")
      .update(JSON.stringify([thread, agent, tool, canonical(args), binding ?? ""]))
      .digest("hex");
  const sessions = new Map<string, ToolApproval>();
  const read = (): ToolApproval[] => {
    try {
      return ToolApproval.array().parse(JSON.parse(settings.get("tool_approvals") ?? "[]"));
    } catch {
      return [];
    }
  };
  const write = (rows: ToolApproval[]) => settings.set("tool_approvals", JSON.stringify(rows));
  const sessionKey = (key: string, thread: string) => JSON.stringify([key, thread]);
  const repo = {
    /** Without `agent`, only grants for every agent count. */
    allows(a: ApprovalTarget, thread?: string, agent?: string): boolean {
      return (
        read().some((g) => g.scope === "always" && g.key === a.key && (!g.agent_id || g.agent_id === agent)) ||
        (!!thread && sessions.has(sessionKey(a.key, thread)))
      );
    },
    grant(a: ApprovalTarget, scope: ApprovalScope, thread: string, agent?: string): void {
      if (scope === "once") return;
      const g: ToolApproval = {
        key: a.key,
        server: a.server,
        tool: a.tool,
        ...(a.project_id ? { project_id: a.project_id } : {}),
        scope,
        ...(scope === "session" ? { thread_id: thread } : {}),
        ...(scope === "always" && agent ? { agent_id: agent } : {}),
      };
      if (scope === "session") sessions.set(sessionKey(a.key, thread), g);
      else write([...read().filter((r) => r.key !== a.key || r.agent_id !== g.agent_id), g]);
      for (const listener of listeners) listener();
    },
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    grantOnce(thread: string, agent: string, tool: string, args: unknown, binding?: string, server?: string): void {
      const key = onceKey(thread, agent, tool, args, binding);
      settings.set(
        "tool_once_grants",
        JSON.stringify([
          ...onceRead().filter((g) => g.key !== key),
          { key, until: Date.now() + 30 * 60_000, binding, server },
        ]),
      );
    },
    takeOnce(thread: string, agent: string, tool: string, args: unknown, binding?: string): boolean {
      const key = onceKey(thread, agent, tool, args, binding);
      const grants = onceRead();
      const found = grants.some((g) => g.key === key);
      if (!found) return false;
      settings.set("tool_once_grants", JSON.stringify(grants.filter((g) => g.key !== key)));
      return found;
    },
    list(thread?: string): ToolApproval[] {
      return [...read(), ...[...sessions.values()].filter((g) => !thread || g.thread_id === thread)];
    },
    /** Without `agent`, the grant for every agent; one agent's grants are revoked by naming it. */
    revoke(key: string, thread?: string, agent?: string): void {
      if (!thread) write(read().filter((g) => g.key !== key || g.agent_id !== agent));
      settings.set("tool_once_grants", JSON.stringify(onceRead().filter((g) => g.binding !== key)));
      if (!agent)
        for (const [k, g] of sessions) if (g.key === key && (!thread || g.thread_id === thread)) sessions.delete(k);
    },
    endSession(thread: string): void {
      for (const [k, g] of sessions) if (g.thread_id === thread) sessions.delete(k);
    },
    revokeServer(server: string): void {
      settings.set("tool_once_grants", JSON.stringify(onceRead().filter((g) => g.server !== server)));
      write(read().filter((g) => g.server !== server));
      for (const [k, g] of sessions) if (g.server === server) sessions.delete(k);
    },
  };
  return repo;
}
