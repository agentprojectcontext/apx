// Agents: list, create, edit, archive. A project agent's definition is its file (.apc/agents/<slug>.md): edits are
// written there and read back through the index; what only APX knows (model choice, browser profile) lives in the
// database. Global agents (no project) live in the database.
import type { Agent, ModelChoice } from "@apx/protocol";
import type { ApcSync } from "../apc/sync.ts";
import {
  archiveAgentFile,
  deleteArchivedAgentFiles,
  renameAgentFile,
  restoreAgentFile,
  updateAgentFile,
  writeNewAgent,
} from "../apc/write.ts";
import { type AgentRecord, publicAgent } from "../domain/agents.ts";
import type { EngineIds } from "../domain/refs.ts";
import type { Store } from "../domain/store.ts";
import { badRequest, errorMessage, notFound } from "../errors.ts";
import { refProblem } from "../models/choice.ts";
import { toolCatalog } from "../tools/policy.ts";
import type { Tool } from "../tools/types.ts";
import type { Handlers } from "./router.ts";

/** Engines a model ref may name. Harness engines are asked live: ACP agents come from settings. */

export function agentHandlers(store: Store, apc: ApcSync, engines: EngineIds, tools: readonly Tool[] = []) {
  /** A choice that names a model nothing can run is refused when it is set, not on every turn after. */
  const checkChoice = (c: ModelChoice | null | undefined) => {
    const why = c?.model ? refProblem(c.model, engines) : undefined;
    if (why) throw badRequest(why);
  };
  /** The folder of a project agent's project, or a clear refusal. */
  const rootOf = (projectId: string): string => {
    const p = store.projects.get(projectId);
    if (!p?.path) throw notFound(`project ${projectId}`);
    if (!p.present) throw badRequest(`the folder of project ${p.name} is not on disk right now`);
    return p.path;
  };
  /** Runs a file operation, turning file errors into a typed refusal. */
  /** Restoring or deleting is only for an archived agent: an active one is archived first. */
  const archivedOne = (id: string): AgentRecord => {
    const cur = store.agents.archived().find((a) => a.id === id);
    if (!cur) throw store.agents.get(id) ? badRequest(`agent ${id} is not archived`) : notFound(`agent ${id}`);
    return cur;
  };
  const onDisk = <T>(fn: () => T): T => {
    try {
      return fn();
    } catch (err) {
      throw badRequest(errorMessage(err));
    }
  };
  /** Sets what only APX knows about an agent (kept across reindexes). */
  const setLocal = (
    cur: AgentRecord,
    p: { browser_profile?: Agent["browser_profile"] | undefined; model_choice?: ModelChoice | null | undefined },
  ) => {
    const { harness: _h, model_choice: _m, ...rest } = cur;
    const next = p.model_choice === undefined ? cur.model_choice : (p.model_choice ?? undefined);
    store.agents.upsert({
      ...rest,
      ...(p.browser_profile ? { browser_profile: p.browser_profile } : {}),
      ...(next ? { model_choice: next } : {}),
    });
  };
  /** How a parent names an agent: a project agent by its slug, a global one (which has none) by its id. */
  const keyOf = (a: AgentRecord) => (a.project_id ? a.slug : (a.slug ?? a.id));
  /**
   * A parent is another agent of the same project (globals: another global, the super-agent included), and never one
   * of the agent's own reports (no loops). The super-agent reports to nobody.
   */
  const checkParent = (cur: AgentRecord, parent: string | undefined) => {
    if (!parent) return;
    if (cur.kind === "secretary") throw badRequest("the super-agent reports to nobody");
    const me = keyOf(cur);
    const team = store.agents.list().filter((a) => a.project_id === cur.project_id && keyOf(a));
    const byKey = new Map(team.map((a) => [keyOf(a) as string, a]));
    if (parent === me || !byKey.has(parent)) throw badRequest(`${parent} is not another agent of this project`);
    for (let p: string | undefined = parent, hops = 0; p && hops <= team.length; p = byKey.get(p)?.parent, hops++)
      if (p === me) throw badRequest(`${parent} already reports to ${cur.name}: that would make a loop`);
  };
  const fresh = (id: string) => {
    const a = store.agents.get(id);
    if (!a) throw notFound(`agent ${id}`);
    return publicAgent(a);
  };

  return {
    "agents.list": () => ({ agents: store.agents.list().map(publicAgent) }),
    "agents.tools": () => ({ tools: toolCatalog(tools) }),
    "agents.get": ({ agent }) => {
      const a = store.agents.get(agent);
      if (!a) throw notFound(`agent ${agent}`);
      return { agent: publicAgent(a), prompt: a.prompt };
    },

    "agents.create": (p) => {
      checkChoice(p.model_choice);
      if (!p.project_id) {
        if (store.agents.get(p.slug)) throw badRequest(`an agent with id ${p.slug} exists`);
        store.agents.upsert({
          id: p.slug,
          name: p.name,
          role: p.role,
          ...(p.description ? { description: p.description } : {}),
          kind: "agent",
          browser_profile: "shared",
          prompt: p.prompt,
          ...(p.blob ? { blob: p.blob } : {}),
          ...(p.model_choice ? { model_choice: p.model_choice } : {}),
        });
        return fresh(p.slug);
      }
      const root = rootOf(p.project_id);
      onDisk(() =>
        writeNewAgent(
          root,
          p.slug,
          { name: p.name, role: p.role, description: p.description, parent: p.parent, icon: p.blob },
          p.prompt,
        ),
      );
      apc.sync(p.project_id);
      const created = store.agents.forFile(p.project_id, p.slug, []);
      if (!created) throw badRequest("the agent file was written but could not be read back");
      if (p.model_choice) setLocal(created, { model_choice: p.model_choice });
      return fresh(created.id);
    },

    "agents.update": (p) => {
      const cur = store.agents.get(p.agent);
      if (!cur) throw notFound(`agent ${p.agent}`);
      const model_choice = p.model_choice;
      checkChoice(model_choice);
      checkParent(cur, p.parent);
      const definition = {
        name: p.name,
        role: p.role,
        description: p.description,
        parent: p.parent,
        icon: p.blob,
        area: p.area,
        personality: p.personality,
        autonomy: p.autonomy,
        tools: p.tools,
        skills: p.skills,
      };
      const edits =
        Object.values(definition).some((v) => v !== undefined) || p.prompt !== undefined || p.slug !== undefined;
      if (edits && cur.source === "apc" && cur.project_id && cur.slug) {
        const root = rootOf(cur.project_id);
        const slug = p.slug ?? cur.slug;
        // Its reports name it by slug: a rename moves them along, so the team chart keeps its shape.
        const reports =
          slug !== cur.slug
            ? store.agents.list().filter((a) => a.project_id === cur.project_id && a.parent === cur.slug)
            : [];
        onDisk(() => {
          if (slug !== cur.slug) renameAgentFile(root, cur.slug as string, slug);
          updateAgentFile(root, slug, definition, p.prompt);
          for (const r of reports) if (r.slug) updateAgentFile(root, r.slug, { parent: slug });
        });
        apc.sync(cur.project_id);
      } else if (edits) {
        if (p.slug !== undefined) throw badRequest("only project agents have a file to rename");
        const { harness: _h, ...rest } = cur;
        store.agents.upsert({
          ...rest,
          ...(p.name ? { name: p.name } : {}),
          ...(p.role !== undefined ? { role: p.role } : {}),
          ...(p.description !== undefined ? { description: p.description } : {}),
          ...(p.area !== undefined ? { area: p.area || undefined } : {}),
          ...(p.parent !== undefined ? { parent: p.parent || undefined } : {}),
          ...(p.autonomy ? { autonomy: p.autonomy } : {}),
          ...(p.prompt !== undefined ? { prompt: p.prompt } : {}),
          ...(p.personality !== undefined ? { personality: p.personality || undefined } : {}),
          ...(p.tools !== undefined ? { tools: p.tools.length ? p.tools : undefined } : {}),
          ...(p.skills !== undefined ? { skills: p.skills.length ? p.skills : undefined } : {}),
          ...(p.blob ? { blob: p.blob } : {}),
        });
      }
      const now = store.agents.get(cur.id) ?? cur;
      if (model_choice !== undefined || p.browser_profile)
        setLocal(now, { browser_profile: p.browser_profile, model_choice });
      return fresh(cur.id);
    },

    "agents.archive": ({ agent }) => {
      const cur = store.agents.get(agent);
      if (!cur) throw notFound(`agent ${agent}`);
      if (cur.kind === "secretary") throw badRequest("the secretary cannot be archived");
      let moved: string | undefined;
      if (cur.source === "apc" && cur.project_id && cur.slug) {
        const root = rootOf(cur.project_id);
        const slug = cur.slug;
        // Its reports move up to its own parent (or the top), as in v1: nobody points at an archived file.
        const reports = store.agents.list().filter((a) => a.project_id === cur.project_id && a.parent === slug);
        moved = onDisk(() => {
          for (const r of reports) if (r.slug) updateAgentFile(root, r.slug, { parent: cur.parent ?? "" });
          return archiveAgentFile(root, slug);
        });
        apc.sync(cur.project_id);
      }
      store.agents.archive(cur.id);
      return { ok: true as const, ...(moved ? { moved_to: moved } : {}) };
    },
    "agents.archived": ({ project_id }) => ({ agents: store.agents.archived(project_id).map(publicAgent) }),
    "agents.restore": ({ agent }) => {
      const cur = archivedOne(agent);
      if (cur.source === "apc" && cur.project_id && cur.slug) {
        const root = rootOf(cur.project_id);
        const slug = cur.slug;
        onDisk(() => restoreAgentFile(root, slug));
        // The sync finds the file again and lists the agent as active, with what the owner set in APX.
        apc.sync(cur.project_id);
      }
      store.agents.unarchive(cur.id);
      const back = store.agents.get(cur.id);
      if (!back) throw notFound(`agent ${agent}`);
      return publicAgent(back);
    },
    "agents.delete": ({ agent }) => {
      const cur = archivedOne(agent);
      if (cur.source === "apc" && cur.project_id && cur.slug) {
        const root = rootOf(cur.project_id);
        const slug = cur.slug;
        onDisk(() => deleteArchivedAgentFiles(root, slug));
      }
      store.memories.removeAgentNotes(cur.id);
      store.agents.purge(cur.id);
      return { ok: true as const };
    },
  } satisfies Partial<Handlers>;
}
