// Agents are always addressed by id. Names are for people and models; turning a name into an id is an explicit,
// scoped lookup (`resolve`) that refuses ambiguity instead of picking one.
import type { Agent, HarnessId, ModelChoice } from "@apx/protocol";
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
  ...withChoice(r.model_choice ? (JSON.parse(String(r.model_choice)) as ModelChoice) : undefined),
  prompt: String(r.prompt),
});

const HARNESS_ENGINES = new Set<string>(["claude", "codex"]);

/** The engine part of a model ref ("claude/x" → "claude"). */
export const engineOf = (ref: string): string => ref.split("/")[0] ?? ref;

/** The harness that runs a model ref: Claude Code or Codex for theirs, our own loop for every provider. */
export const harnessOf = (ref: string): HarnessId => {
  const e = engineOf(ref);
  return HARNESS_ENGINES.has(e) ? (e as HarnessId) : "native";
};

const withChoice = (c: ModelChoice | undefined): Pick<Agent, "model_choice" | "harness"> =>
  c ? { model_choice: c, ...(c.model ? { harness: harnessOf(c.model) } : {}) } : {};

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
        `INSERT INTO agents (id, name, role, kind, blob, project_id, browser_profile, prompt, created_at, model_choice)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, role = excluded.role, kind = excluded.kind, blob = excluded.blob,
           project_id = excluded.project_id, browser_profile = excluded.browser_profile, prompt = excluded.prompt,
           model_choice = excluded.model_choice`,
        a.id,
        a.name,
        a.role,
        a.kind,
        a.blob ?? null,
        a.project_id ?? null,
        a.browser_profile,
        a.prompt ?? "",
        now(),
        a.model_choice ? JSON.stringify(a.model_choice) : null,
      );
    },
  };
  return repo;
}

/** What clients see: the prompt stays in the core. */
export const publicAgent = ({ prompt: _p, ...a }: AgentRecord): Agent => a;
