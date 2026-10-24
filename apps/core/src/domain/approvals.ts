// Owner grants: durable for every agent or for one, or limited to one chat.
import { createHash } from "node:crypto";
import path from "node:path";
import { type ApprovalScope, COMPUTER_GRANT, STRICT_APPROVAL, ToolApproval } from "@apx/protocol";
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
/** Grants that are one agent's even "for this chat": another agent in that chat is not covered (DECISIONS.md#d-151). */
const PER_AGENT = new Set([COMPUTER_GRANT]);

/** The computer is a permission, not one call: this chat or for good (DECISIONS.md#d-151). */
export const approvalScopes = (a: ApprovalTarget): ApprovalScope[] =>
  a.key === COMPUTER_GRANT ? ["session", "always"] : ["once", "session", "always"];

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

/** The key prefix of a folder an agent may change for good, from a folder card's "always" (DECISIONS.md#d-108). */
const WRITE_FOLDER = `${APX_SERVER}:write_folder:`;

/** The grant letting an agent change files in a folder outside its own; the folder shows as its condition. */
export const writeFolderApproval = (dir: string): ApprovalTarget => ({
  key: `${WRITE_FOLDER}${dir}`,
  server: APX_SERVER,
  tool: "write_folder",
  permanent: false,
});

/** A host when the text is a URL, else undefined. */
const hostOf = (v: string): string | undefined => {
  if (!/^https?:\/\//i.test(v)) return undefined;
  try {
    return new URL(v).hostname.toLowerCase();
  } catch {
    return undefined;
  }
};

/**
 * Whether a call's arguments fall inside a grant's condition: one of its text arguments (lists too) starts with one of
 * the comma-separated patterns, or is a URL on that domain or under it. No arguments known: no match.
 */
export function matchesCondition(condition: string, args: unknown): boolean {
  const patterns = condition
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  if (!patterns.length) return true;
  if (!args || typeof args !== "object") return false;
  const values = Object.values(args as Record<string, unknown>).flatMap((v) =>
    typeof v === "string" ? [v] : Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [],
  );
  return values.some((v) => {
    const host = hostOf(v);
    return patterns.some((p) => {
      const pat = p.toLowerCase();
      if (host) return host === pat || host.endsWith(`.${pat}`);
      const norm = v.replace(/^\.\//, "");
      return norm === p || norm.startsWith(p.replace(/^\.\//, ""));
    });
  });
}

const live = (g: ToolApproval) => !g.expires_at || Date.parse(g.expires_at) > Date.now();

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
  const sessionKey = (key: string, thread: string, agent?: string) =>
    JSON.stringify(PER_AGENT.has(key) ? [key, thread, agent ?? ""] : [key, thread]);
  // "For this chat" lasts as long as the chat, a core restart included; archiving or deleting it ends it.
  const sessions = new Map<string, ToolApproval>();
  try {
    for (const g of ToolApproval.array().parse(JSON.parse(settings.get("tool_session_grants") ?? "[]")))
      if (g.thread_id) sessions.set(sessionKey(g.key, g.thread_id, g.agent_id), g);
  } catch {}
  const saveSessions = () => settings.set("tool_session_grants", JSON.stringify([...sessions.values()]));
  const read = (): ToolApproval[] => {
    try {
      // A grant past its date is gone: the next call asks again.
      return ToolApproval.array()
        .parse(JSON.parse(settings.get("tool_approvals") ?? "[]"))
        .filter(live);
    } catch {
      return [];
    }
  };
  const write = (rows: ToolApproval[]) => settings.set("tool_approvals", JSON.stringify(rows));
  const repo = {
    /** Without `agent`, only grants for every agent count; a grant with a condition needs the call's `args`. */
    allows(a: ApprovalTarget, thread?: string, agent?: string, args?: unknown): boolean {
      return (
        read().some(
          (g) =>
            g.scope === "always" &&
            g.key === a.key &&
            (!g.agent_id || g.agent_id === agent) &&
            (!g.condition || matchesCondition(g.condition, args)),
        ) ||
        (!!thread && sessions.has(sessionKey(a.key, thread, agent)))
      );
    },
    grant(a: ApprovalTarget, scope: ApprovalScope, thread: string, agent?: string): void {
      // A folder card's `project` adds a read-only folder (inputs.respond), never a grant.
      if (scope === "once" || scope === "project") return;
      const g: ToolApproval = {
        key: a.key,
        server: a.server,
        tool: a.tool,
        ...(a.project_id ? { project_id: a.project_id } : {}),
        scope,
        ...(scope === "session" ? { thread_id: thread } : {}),
        ...((scope === "always" || PER_AGENT.has(a.key)) && agent ? { agent_id: agent } : {}),
        granted_at: new Date().toISOString(),
        ...(scope === "always" && thread ? { from_thread: thread } : {}),
        // A folder grant names its folder where the owner sees and narrows grants.
        ...(a.key.startsWith(WRITE_FOLDER) && a.key.length - WRITE_FOLDER.length <= 200
          ? { condition: a.key.slice(WRITE_FOLDER.length) }
          : {}),
      };
      if (scope === "session") {
        sessions.set(sessionKey(a.key, thread, agent), g);
        saveSessions();
      } else write([...read().filter((r) => r.key !== a.key || r.agent_id !== g.agent_id), g]);
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
    /** Narrows a grant for good to a condition, or gives it an end date ("" clears either). */
    update(
      key: string,
      agent: string | undefined,
      change: { condition?: string | undefined; expires_at?: string | undefined },
    ): ToolApproval | undefined {
      const rows = read();
      const at = rows.findIndex((g) => g.key === key && g.agent_id === agent);
      const cur = rows[at];
      if (!cur) return undefined;
      const { condition: _c, expires_at: _e, ...rest } = cur;
      const condition = change.condition !== undefined ? change.condition.trim() : cur.condition;
      const expires = change.expires_at !== undefined ? change.expires_at : cur.expires_at;
      const next: ToolApproval = {
        ...rest,
        ...(condition ? { condition } : {}),
        ...(expires ? { expires_at: expires } : {}),
      };
      rows[at] = next;
      write(rows);
      for (const listener of listeners) listener();
      return next;
    },
    /** The folders outside its own an agent may change for good; a grant narrowed by the owner covers its condition. */
    writeFolders(agent: string): string[] {
      return read()
        .filter((g) => g.scope === "always" && g.key.startsWith(WRITE_FOLDER) && (!g.agent_id || g.agent_id === agent))
        .flatMap((g) => (g.condition ? g.condition.split(",") : [g.key.slice(WRITE_FOLDER.length)]))
        .map((d) => d.trim())
        .filter((d) => path.isAbsolute(d));
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
      saveSessions();
    },
    /** Every grant of one agent under a key, for good and for single chats. */
    revokeAgent(key: string, agent: string): void {
      write(read().filter((g) => g.key !== key || g.agent_id !== agent));
      for (const [k, g] of sessions) if (g.key === key && g.agent_id === agent) sessions.delete(k);
      saveSessions();
      for (const listener of listeners) listener();
    },
    endSession(thread: string): void {
      const before = sessions.size;
      for (const [k, g] of sessions) if (g.thread_id === thread) sessions.delete(k);
      if (sessions.size !== before) saveSessions();
    },
    revokeServer(server: string): void {
      settings.set("tool_once_grants", JSON.stringify(onceRead().filter((g) => g.server !== server)));
      write(read().filter((g) => g.server !== server));
      for (const [k, g] of sessions) if (g.server === server) sessions.delete(k);
      saveSessions();
    },
  };
  return repo;
}
