// Agents: list, create, edit, archive. A project agent's definition is its file (.apc/agents/<slug>.md): edits are
// written there and read back through the index; what only APX knows (model choice, browser profile) lives in the
// database. Global agents (no project) live in the database.
import type { Agent, ModelChoice } from "@apx/protocol";
import type { ApcSync } from "../apc/sync.ts";
import { archiveAgentFile, renameAgentFile, updateAgentFile, writeNewAgent } from "../apc/write.ts";
import { type AgentRecord, publicAgent } from "../domain/agents.ts";
import type { Store } from "../domain/store.ts";
import { CallError } from "../errors.ts";
import { refProblem } from "../models/choice.ts";
import type { Handler } from "./router.ts";
import { notFound } from "./threads.ts";

const refuse = (message: string) => new CallError({ code: "bad_request", message });

/** Engines a model ref may name. Harness engines are asked live: ACP agents come from settings. */
export type EngineIds = { harness: { has(id: string): boolean }; providers: { has(id: string): boolean } };

export function agentHandlers(store: Store, apc: ApcSync, engines: EngineIds) {
  /** A choice that names a model nothing can run is refused when it is set, not on every turn after. */
  const checkChoice = (c: ModelChoice | null | undefined) => {
    const why = c?.model ? refProblem(c.model, engines) : undefined;
    if (why) throw refuse(why);
  };
  /** The folder of a project agent's project, or a clear refusal. */
  const rootOf = (projectId: string): string => {
    const p = store.projects.get(projectId);
    if (!p?.path) throw notFound(`project ${projectId}`);
    if (!p.present) throw refuse(`the folder of project ${p.name} is not on disk right now`);
    return p.path;
  };
  /** Runs a file operation, turning file errors into a typed refusal. */
  const onDisk = <T>(fn: () => T): T => {
    try {
      return fn();
    } catch (err) {
      throw refuse(err instanceof Error ? err.message : String(err));
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
  const fresh = (id: string) => {
    const a = store.agents.get(id);
    if (!a) throw notFound(`agent ${id}`);
    return publicAgent(a);
  };

  return {
    "agents.list": (() => ({ agents: store.agents.list().map(publicAgent) })) as Handler<"agents.list">,

    "agents.create": ((p) => {
      checkChoice(p.model_choice);
      if (!p.project_id) {
        if (store.agents.get(p.slug)) throw refuse(`an agent with id ${p.slug} exists`);
        store.agents.upsert({
          id: p.slug,
          name: p.name,
          role: p.role,
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
      if (!created) throw refuse("the agent file was written but could not be read back");
      if (p.model_choice) setLocal(created, { model_choice: p.model_choice });
      return fresh(created.id);
    }) as Handler<"agents.create">,

    "agents.update": ((p) => {
      const cur = store.agents.get(p.agent);
      if (!cur) throw notFound(`agent ${p.agent}`);
      const model_choice = p.model_choice;
      checkChoice(model_choice);
      const definition = { name: p.name, role: p.role, description: p.description, parent: p.parent, icon: p.blob };
      const edits =
        Object.values(definition).some((v) => v !== undefined) || p.prompt !== undefined || p.slug !== undefined;
      if (edits && cur.source === "apc" && cur.project_id && cur.slug) {
        const root = rootOf(cur.project_id);
        const slug = p.slug ?? cur.slug;
        onDisk(() => {
          if (slug !== cur.slug) renameAgentFile(root, cur.slug as string, slug);
          updateAgentFile(root, slug, definition, p.prompt);
        });
        apc.sync(cur.project_id);
      } else if (edits) {
        if (p.slug !== undefined) throw refuse("only project agents have a file to rename");
        const { harness: _h, ...rest } = cur;
        store.agents.upsert({
          ...rest,
          ...(p.name ? { name: p.name } : {}),
          ...(p.role !== undefined ? { role: p.role } : {}),
          ...(p.prompt !== undefined ? { prompt: p.prompt } : {}),
          ...(p.blob ? { blob: p.blob } : {}),
        });
      }
      const now = store.agents.get(cur.id) ?? cur;
      if (model_choice !== undefined || p.browser_profile)
        setLocal(now, { browser_profile: p.browser_profile, model_choice });
      return fresh(cur.id);
    }) as Handler<"agents.update">,

    "agents.archive": (({ agent }) => {
      const cur = store.agents.get(agent);
      if (!cur) throw notFound(`agent ${agent}`);
      if (cur.kind === "secretary") throw refuse("the secretary cannot be archived");
      let moved: string | undefined;
      if (cur.source === "apc" && cur.project_id && cur.slug) {
        const root = rootOf(cur.project_id);
        const slug = cur.slug;
        moved = onDisk(() => archiveAgentFile(root, slug));
      }
      store.agents.archive(cur.id);
      return { ok: true as const, ...(moved ? { moved_to: moved } : {}) };
    }) as Handler<"agents.archive">,
  };
}
