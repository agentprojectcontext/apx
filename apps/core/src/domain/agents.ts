// Agents are always addressed by id. Names are for people and models; turning a name into an id is an explicit,
// scoped lookup (`resolve`) that refuses ambiguity instead of picking one.
import type { Agent } from "@apx/protocol";
import { now, opt, type Row, type Sql } from "./sql.ts";

export type AgentRecord = Agent & { prompt: string };

const toAgent = (r: Row): AgentRecord => ({
  id: String(r.id),
  name: String(r.name),
  role: String(r.role),
  kind: r.kind as Agent["kind"],
  ...opt("blob", r.blob),
  ...opt("project_id", r.project_id),
  browser_profile: r.browser_profile as Agent["browser_profile"],
  ...opt("model", r.model),
  ...(r.harness ? { harness: r.harness as NonNullable<Agent["harness"]> } : {}),
  prompt: String(r.prompt),
});

export type Resolved = { agent: AgentRecord } | { error: string };

export function agentsRepo({ one, all, run }: Sql) {
  const repo = {
    list(): AgentRecord[] {
      return all("SELECT * FROM agents ORDER BY kind DESC, name").map(toAgent);
    },
    get(id: string): AgentRecord | undefined {
      const r = one("SELECT * FROM agents WHERE id = ?", id);
      return r ? toAgent(r) : undefined;
    },
    /**
     * Id first; otherwise a case-insensitive name match among global agents and the given project's team.
     * More than one match is an error that lists the ids, never a guess.
     */
    resolve(ref: string, projectId: string | undefined): Resolved {
      const byId = repo.get(ref);
      if (byId) return { agent: byId };
      const matches = all(
        "SELECT * FROM agents WHERE lower(name) = lower(?) AND (project_id IS NULL OR project_id = ?)",
        ref,
        projectId ?? "",
      ).map(toAgent);
      if (matches.length === 1 && matches[0]) return { agent: matches[0] };
      if (matches.length > 1) return { error: `"${ref}" matches ${matches.map((a) => a.id).join(", ")}; use the id` };
      return { error: `unknown agent "${ref}"; use list_agents to find its id` };
    },
    upsert(a: Agent & { prompt?: string }): void {
      run(
        `INSERT INTO agents (id, name, role, kind, blob, project_id, browser_profile, model, prompt, created_at, harness)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, role = excluded.role, kind = excluded.kind, blob = excluded.blob,
           project_id = excluded.project_id, browser_profile = excluded.browser_profile, model = excluded.model,
           prompt = excluded.prompt, harness = excluded.harness`,
        a.id,
        a.name,
        a.role,
        a.kind,
        a.blob ?? null,
        a.project_id ?? null,
        a.browser_profile,
        a.model ?? null,
        a.prompt ?? "",
        now(),
        a.harness ?? null,
      );
    },
  };
  return repo;
}

/** What clients see: the prompt stays in the core. */
export const publicAgent = ({ prompt: _p, ...a }: AgentRecord): Agent => a;
