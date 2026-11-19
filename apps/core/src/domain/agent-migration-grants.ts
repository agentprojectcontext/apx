import { ToolApproval } from "@apx/protocol";
import { badRequest } from "../errors.ts";
import { settingsRepo } from "./settings.ts";
import type { Sql } from "./sql.ts";

type Scope = { agent: string; threads: string[] };
const keys = ["tool_approvals", "tool_session_grants"] as const;

function rows(q: Sql, key: string) {
  try {
    return ToolApproval.array().parse(JSON.parse(settingsRepo(q).get(key) ?? "[]"));
  } catch {
    throw badRequest("Review saved permissions before moving this agent");
  }
}
const matches = (g: ToolApproval, scope: Scope) =>
  g.agent_id === scope.agent || (!!g.thread_id && scope.threads.includes(g.thread_id));

export function migrationGrants(q: Sql, scope: Scope) {
  return keys.map((key) => ({ key, grants: rows(q, key).filter((g) => matches(g, scope)) }));
}

export function suspendMigrationGrants(q: Sql, scope: Scope) {
  for (const key of keys) settingsRepo(q).set(key, JSON.stringify(rows(q, key).filter((g) => !matches(g, scope))));
}

export function restoreMigrationGrants(q: Sql, saved: ReturnType<typeof migrationGrants>) {
  for (const entry of saved) settingsRepo(q).set(entry.key, JSON.stringify([...rows(q, entry.key), ...entry.grants]));
}
