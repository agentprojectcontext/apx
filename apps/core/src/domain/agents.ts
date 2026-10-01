// Agents are always addressed by id. Names are for people and models; turning a name into an id is an explicit,
// scoped lookup (`resolve`) that refuses ambiguity instead of picking one.
import { type Agent, Autonomy, type HarnessId, type ModelChoice } from "@apx/protocol";
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
  ...opt("slug", r.slug),
  ...opt("parent", r.parent),
  ...opt("description", r.description),
  source: r.source === "apc" ? "apc" : "local",
  ...policyOf(r.extra),
  prompt: String(r.prompt),
});

/** `tools:` and `autonomy:` as the agent's file wrote them; unknown autonomy values mean the default. */
function policyOf(extra: unknown): Pick<Agent, "tools" | "autonomy" | "skills"> {
  let e: { tools?: unknown; autonomy?: unknown; skills?: unknown } = {};
  try {
    e = extra ? JSON.parse(String(extra)) : {};
  } catch {}
  const tools = Array.isArray(e.tools) ? e.tools.map(String).filter(Boolean) : [];
  const autonomy = Autonomy.safeParse(String(e.autonomy ?? "").toLowerCase());
  const skills = Array.isArray(e.skills) ? e.skills.map(String).filter(Boolean) : [];
  return {
    ...(tools.length ? { tools } : {}),
    ...(autonomy.success ? { autonomy: autonomy.data } : {}),
    ...(skills.length ? { skills } : {}),
  };
}

const HARNESS_ENGINES = new Set<string>(["claude", "codex"]);

/** The engine part of a model ref ("claude/x" → "claude"). */
export const engineOf = (ref: string): string => ref.split("/")[0] ?? ref;

/** The harness that runs a model ref: Claude Code, Codex or an ACP agent for theirs, our own loop for providers. */
export const harnessOf = (ref: string): HarnessId => {
  const e = engineOf(ref);
  if (e.startsWith("acp:")) return "acp";
  return HARNESS_ENGINES.has(e) ? (e as HarnessId) : "native";
};

const withChoice = (c: ModelChoice | undefined): Pick<Agent, "model_choice" | "harness"> =>
  c ? { model_choice: c, ...(c.model ? { harness: harnessOf(c.model) } : {}) } : {};

export type Resolved = { agent: AgentRecord } | { error: string };

export function agentsRepo({ one, all, run }: Sql) {
  const repo = {
    /** Active agents (an agent whose file was removed from its project is archived and not listed). */
    list(): AgentRecord[] {
      return all("SELECT * FROM agents WHERE archived = 0 ORDER BY kind DESC, name").map(toAgent);
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
        "SELECT * FROM agents WHERE archived = 0 AND (lower(name) = lower(?) OR slug = lower(?)) AND (project_id IS NULL OR project_id = ?)",
        ref,
        ref,
        projectId ?? "",
      ).map(toAgent);
      if (matches.length === 1 && matches[0]) return { agent: matches[0] };
      if (matches.length > 1) return { error: `"${ref}" matches ${matches.map((a) => a.id).join(", ")}; use the id` };
      return { error: `unknown agent "${ref}"; use list_agents to find its id` };
    },
    /**
     * Mirrors an agent defined in a project file. The file owns name, role, prompt and hierarchy; what the owner set in
     * APX (model choice, browser profile) is kept.
     */
    upsertApc(a: {
      id: string;
      project_id: string;
      slug: string;
      name: string;
      role: string;
      prompt: string;
      description?: string | undefined;
      parent?: string | undefined;
      blob?: string | undefined;
      model_choice?: ModelChoice | undefined;
      extra: unknown;
    }): void {
      run(
        `INSERT INTO agents (id, name, role, kind, blob, project_id, browser_profile, prompt, created_at, model_choice, slug, source, parent, description, extra, archived)
         VALUES (?, ?, ?, 'agent', ?, ?, 'isolated', ?, ?, ?, ?, 'apc', ?, ?, ?, 0)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, role = excluded.role, blob = COALESCE(excluded.blob, agents.blob),
           project_id = excluded.project_id, prompt = excluded.prompt, slug = excluded.slug, source = 'apc',
           parent = excluded.parent, description = excluded.description, extra = excluded.extra, archived = 0`,
        a.id,
        a.name,
        a.role,
        a.blob ?? null,
        a.project_id,
        a.prompt,
        now(),
        a.model_choice ? JSON.stringify(a.model_choice) : null,
        a.slug,
        a.parent ?? null,
        a.description ?? null,
        JSON.stringify(a.extra ?? {}),
      );
    },
    /**
     * The agent a project file stands for: same slug, or the file's slug was this agent's before a rename (its
     * aliases list it), or the file lists this agent's current slug among its own aliases.
     */
    forFile(
      projectId: string,
      slug: string,
      aliases: string[],
      /** Slugs whose files exist now: an agent whose own file is still there was not renamed. */
      present: ReadonlySet<string> = new Set([slug]),
    ): AgentRecord | undefined {
      const rows = all("SELECT * FROM agents WHERE project_id = ? AND source = 'apc'", projectId);
      const moved = rows.filter((r) => !present.has(String(r.slug)));
      const hit =
        rows.find((r) => r.slug === slug) ??
        moved.find((r) => aliases.includes(String(r.slug))) ??
        moved.find((r) =>
          ((JSON.parse(String(r.extra ?? "{}")) as { aliases?: string[] }).aliases ?? []).includes(slug),
        );
      return hit ? toAgent(hit) : undefined;
    },
    archive(id: string): void {
      run("UPDATE agents SET archived = 1 WHERE id = ?", id);
    },
    /** Archives the project's file-defined agents that are not in `keep` (their files are gone). */
    archiveMissing(projectId: string, keep: string[]): number {
      const ids = all("SELECT id FROM agents WHERE project_id = ? AND source = 'apc' AND archived = 0", projectId)
        .map((r) => String(r.id))
        .filter((id) => !keep.includes(id));
      for (const id of ids) run("UPDATE agents SET archived = 1 WHERE id = ?", id);
      return ids.length;
    },
    upsert(a: Omit<Agent, "source"> & { source?: Agent["source"]; prompt?: string }): void {
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
