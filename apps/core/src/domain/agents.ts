// Agents are always addressed by id. Names are for people and models; turning a name into an id is an explicit,
// scoped lookup (`resolve`) that refuses ambiguity instead of picking one.
import { type Agent, Autonomy, type ModelChoice } from "@apx/protocol";
import type { Selectable } from "kysely";
import type { AgentsTable } from "../db/schema.ts";
import { harnessOf } from "./refs.ts";
import { now, opt, qb, type Sql } from "./sql.ts";

export type AgentRecord = Agent & { prompt: string };

const toAgent = (r: Selectable<AgentsTable>): AgentRecord => ({
  id: r.id,
  name: r.name,
  role: r.role,
  kind: r.kind as Agent["kind"],
  ...opt("blob", r.blob),
  ...opt("project_id", r.project_id),
  browser_profile: r.browser_profile as Agent["browser_profile"],
  ...withChoice(r.model_choice ? (JSON.parse(r.model_choice) as ModelChoice) : undefined),
  ...opt("slug", r.slug),
  ...opt("parent", r.parent),
  ...opt("description", r.description),
  source: r.source === "apc" ? "apc" : "local",
  ...policyOf(r.extra),
  prompt: r.prompt,
});

/** `tools:` and `autonomy:` as the agent's file wrote them; unknown autonomy values mean the default. */
function policyOf(extra: string | null): Pick<Agent, "tools" | "autonomy" | "skills"> {
  let e: { tools?: unknown; autonomy?: unknown; skills?: unknown } = {};
  try {
    e = extra ? JSON.parse(extra) : {};
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

const withChoice = (c: ModelChoice | undefined): Pick<Agent, "model_choice" | "harness"> =>
  c ? { model_choice: c, ...(c.model ? { harness: harnessOf(c.model) } : {}) } : {};

export type Resolved = { agent: AgentRecord } | { error: string };

export function agentsRepo({ one, all, run }: Sql) {
  const repo = {
    /** Active agents (an agent whose file was removed from its project is archived and not listed). */
    list(): AgentRecord[] {
      return all(
        qb.selectFrom("agents").selectAll().where("archived", "=", 0).orderBy("kind", "desc").orderBy("name"),
      ).map(toAgent);
    },
    get(id: string): AgentRecord | undefined {
      const r = one(qb.selectFrom("agents").selectAll().where("id", "=", id));
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
        qb
          .selectFrom("agents")
          .selectAll()
          .where("archived", "=", 0)
          .where((eb) => {
            const lowerRef = eb.fn<string>("lower", [eb.val(ref)]);
            return eb.or([eb(eb.fn<string>("lower", ["name"]), "=", lowerRef), eb("slug", "=", lowerRef)]);
          })
          .where((eb) => eb.or([eb("project_id", "is", null), eb("project_id", "=", projectId ?? "")])),
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
        qb
          .insertInto("agents")
          .values({
            id: a.id,
            name: a.name,
            role: a.role,
            kind: "agent",
            blob: a.blob ?? null,
            project_id: a.project_id,
            browser_profile: "isolated",
            prompt: a.prompt,
            created_at: now(),
            model_choice: a.model_choice ? JSON.stringify(a.model_choice) : null,
            slug: a.slug,
            source: "apc",
            parent: a.parent ?? null,
            description: a.description ?? null,
            extra: JSON.stringify(a.extra ?? {}),
            archived: 0,
          })
          .onConflict((c) =>
            c.column("id").doUpdateSet((eb) => ({
              name: eb.ref("excluded.name"),
              role: eb.ref("excluded.role"),
              blob: eb.fn.coalesce(eb.ref("excluded.blob"), eb.ref("agents.blob")),
              project_id: eb.ref("excluded.project_id"),
              prompt: eb.ref("excluded.prompt"),
              slug: eb.ref("excluded.slug"),
              source: "apc",
              parent: eb.ref("excluded.parent"),
              description: eb.ref("excluded.description"),
              extra: eb.ref("excluded.extra"),
              archived: 0,
            })),
          ),
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
      const rows = all(
        qb.selectFrom("agents").selectAll().where("project_id", "=", projectId).where("source", "=", "apc"),
      );
      const moved = rows.filter((r) => !present.has(String(r.slug)));
      const hit =
        rows.find((r) => r.slug === slug) ??
        moved.find((r) => aliases.includes(String(r.slug))) ??
        moved.find((r) => ((JSON.parse(r.extra ?? "{}") as { aliases?: string[] }).aliases ?? []).includes(slug));
      return hit ? toAgent(hit) : undefined;
    },
    archive(id: string): void {
      run(qb.updateTable("agents").set({ archived: 1 }).where("id", "=", id));
    },
    /** Archives the project's file-defined agents that are not in `keep` (their files are gone). */
    archiveMissing(projectId: string, keep: string[]): number {
      const ids = all(
        qb
          .selectFrom("agents")
          .select("id")
          .where("project_id", "=", projectId)
          .where("source", "=", "apc")
          .where("archived", "=", 0),
      )
        .map((r) => r.id)
        .filter((id) => !keep.includes(id));
      for (const id of ids) repo.archive(id);
      return ids.length;
    },
    upsert(a: Omit<Agent, "source"> & { source?: Agent["source"]; prompt?: string }): void {
      run(
        qb
          .insertInto("agents")
          .values({
            id: a.id,
            name: a.name,
            role: a.role,
            kind: a.kind,
            blob: a.blob ?? null,
            project_id: a.project_id ?? null,
            browser_profile: a.browser_profile,
            prompt: a.prompt ?? "",
            created_at: now(),
            model_choice: a.model_choice ? JSON.stringify(a.model_choice) : null,
          })
          .onConflict((c) =>
            c.column("id").doUpdateSet((eb) => ({
              name: eb.ref("excluded.name"),
              role: eb.ref("excluded.role"),
              kind: eb.ref("excluded.kind"),
              blob: eb.ref("excluded.blob"),
              project_id: eb.ref("excluded.project_id"),
              browser_profile: eb.ref("excluded.browser_profile"),
              prompt: eb.ref("excluded.prompt"),
              model_choice: eb.ref("excluded.model_choice"),
            })),
          ),
      );
    },
  };
  return repo;
}

/** What clients see: the prompt stays in the core. */
export const publicAgent = ({ prompt: _p, ...a }: AgentRecord): Agent => a;
