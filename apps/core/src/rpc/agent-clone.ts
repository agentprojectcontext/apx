// Copies agents into another project (or among the global ones): the whole definition (role, prompt, tools, skills,
// area, personality, autonomy, model), with reports kept under their cloned boss. An agent belongs to one project,
// so a copy is a new agent; `rename` gives each copy a name nobody on the install uses, so the two read apart.
import { AGENT_NAMES, names } from "@apx/protocol";
import type { ApcSync } from "../apc/sync.ts";
import { updateAgentFile, writeNewAgent } from "../apc/write.ts";
import { type AgentRecord, publicAgent } from "../domain/agents.ts";
import type { Store } from "../domain/store.ts";
import { badRequest, errorMessage, notFound } from "../errors.ts";

export type CloneParams = { agents: string[]; project_id?: string | undefined; rename: boolean; hang_under?: string };

const slugOf = (name: string) =>
  name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^[^a-z]+|-+$/g, "")
    .slice(0, 60) || "agent";

/** A name from the list nobody on the install uses yet, else the name with a number. */
export function freeName(used: Set<string>, fallback: string): string {
  const pool = AGENT_NAMES.filter((n) => !used.has(n.toLowerCase()));
  if (pool.length) return pool[Math.floor(Math.random() * pool.length)] as string;
  for (let i = 2; ; i++) if (!used.has(`${fallback} ${i}`.toLowerCase())) return `${fallback} ${i}`;
}

export function cloneAgents(store: Store, apc: ApcSync, p: CloneParams) {
  const target = p.project_id ? store.projects.get(p.project_id) : undefined;
  if (p.project_id && !target?.path) throw notFound(`project ${p.project_id}`);
  if (target && !target.present) throw badRequest(`the folder of project ${target.name} is not on disk right now`);
  const root = target?.path;
  const team = store.agents.list().filter((a) => a.project_id === p.project_id);
  const keyOf = (a: AgentRecord) => a.slug ?? a.id;
  if (p.hang_under && !team.some((a) => keyOf(a) === p.hang_under))
    throw badRequest(`${p.hang_under} is not an agent of this project`);
  const taken = new Set(team.map(keyOf));
  // Global agents are keyed by id across the install, not only among the globals.
  if (!root) for (const a of store.agents.list()) taken.add(a.id);
  const used = new Set(store.agents.list().map((a) => a.name.toLowerCase()));

  const sources: AgentRecord[] = [];
  const skipped: Array<{ agent: string; reason: string }> = [];
  for (const id of p.agents) {
    const a = store.agents.get(id);
    if (!a) skipped.push({ agent: id, reason: "not found" });
    else if (a.kind === "secretary")
      skipped.push({ agent: a.name, reason: "the super-agent is one for the whole install" });
    else if (a.project_id === p.project_id && !p.rename)
      skipped.push({ agent: a.name, reason: "already in this project (clone it with new names)" });
    else sources.push(a);
  }

  // Each copy's name and slug first, so a report can point at its cloned boss whatever the order.
  const plan = sources.map((a) => {
    const name = p.rename ? freeName(used, a.name) : a.name;
    used.add(name.toLowerCase());
    let slug = slugOf(p.rename ? name : keyOf(a));
    for (let i = 2; taken.has(slug); i++) slug = `${slugOf(p.rename ? name : keyOf(a))}-${i}`;
    taken.add(slug);
    return { a, name, slug };
  });

  const cloned = [];
  for (const { a, name, slug } of plan) {
    // Its parent, named by slug or full id, keeps leading it when both are cloned.
    const parent = plan.find((x) => x.a.id !== a.id && names(x.a, a.parent))?.slug || p.hang_under;
    if (root && p.project_id) {
      try {
        writeNewAgent(root, slug, { name, role: a.role, description: a.description, parent, icon: a.blob }, a.prompt);
        updateAgentFile(root, slug, {
          area: a.area,
          personality: a.personality,
          autonomy: a.autonomy,
          tools: a.tools,
          skills: a.skills,
        });
      } catch (err) {
        skipped.push({ agent: a.name, reason: errorMessage(err) });
        continue;
      }
      apc.sync(p.project_id);
      const made = store.agents.forFile(p.project_id, slug, []);
      if (!made) {
        skipped.push({ agent: a.name, reason: "written but could not be read back" });
        continue;
      }
      if (a.model_choice) {
        const { harness: _h, ...rest } = made;
        store.agents.upsert({ ...rest, model_choice: a.model_choice });
      }
      cloned.push(publicAgent(store.agents.get(made.id) ?? made));
    } else {
      const { harness: _h, project_id: _p, slug: _s, source: _src, ...def } = a;
      store.agents.upsert({ ...def, id: slug, name, kind: "agent", ...(parent ? { parent } : { parent: undefined }) });
      const made = store.agents.get(slug);
      if (made) cloned.push(publicAgent(made));
    }
  }
  return { cloned, skipped };
}
