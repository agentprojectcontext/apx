// Memory methods. The owner manages every note; an agent reads and writes only where its thread lets it: the owner's
// global notes (read), its thread's project and its own notebook.
import type { Memory } from "@apx/protocol";
import { canSee, looksSecret, type MemoryView } from "../domain/memories.ts";
import { memorySettings, saveMemorySettings } from "../domain/memory-settings.ts";
import type { Store } from "../domain/store.ts";
import type { MemoryIndex } from "../engine/memory-index.ts";
import { badRequest, errorMessage, notFound, unauthorized, unavailable } from "../errors.ts";
import type { CallContext } from "./context.ts";
import type { Handlers } from "./router.ts";

export function memoryHandlers(store: Store, index: MemoryIndex) {
  /** The agent's view, or undefined for the owner (who sees everything). */
  const viewOf = (ctx: CallContext): MemoryView | undefined => {
    if (ctx.actor === "human") return undefined;
    if (!ctx.agent) throw unauthorized("only the owner or an agent in a thread can use memory");
    return { agent_id: ctx.agent.id, project_id: store.threads.get(ctx.agent.thread_id)?.project_id };
  };

  /** A new note gets indexed by meaning in the background (when that is on). */
  const indexed = (m: Memory) => {
    index.schedule();
    return m;
  };

  return {
    "memory.list": async ({ query, scope, project, agent, limit }, ctx) => {
      const filters = { view: viewOf(ctx), scope, project_id: project, agent_id: agent, limit };
      return { memories: query ? await index.search({ ...filters, query }) : store.memories.list(filters) };
    },
    "memory.settings": () => {
      const s = memorySettings(store);
      return { ...s, ...store.memories.counts(index.model()) };
    },
    "memory.set_settings": (s) => {
      const saved = saveMemorySettings(store, s);
      index.schedule();
      return saved;
    },
    "memory.reindex": async () => {
      try {
        const r = await index.index();
        return { ...r, ...(index.model() ? { engine: index.model() } : {}) };
      } catch (err) {
        throw unavailable(errorMessage(err, 300));
      }
    },

    "memory.add": ({ text, scope, project, agent, id, tainted }, ctx) => {
      if (looksSecret(text))
        throw badRequest("that looks like a password, key or token: memory never keeps credentials");
      const view = viewOf(ctx);
      if (id) {
        const m = store.memories.get(id);
        if (!m) throw notFound(`memory ${id}`);
        if (view && (m.source === "owner" || !canSee(view, m)))
          throw unauthorized("an agent can only edit notes agents wrote that it can see");
        // The owner vouches for what they write; an agent's note is tainted unless its tool says the turn was clean.
        const edited = store.memories.edit(id, text, view ? (tainted ?? true) : false) ?? m;
        index.schedule();
        return edited;
      }
      if (!view) {
        if (scope === "project" && !(project && store.projects.get(project)))
          throw badRequest("a project note needs a project");
        if (scope === "agent" && !(agent && store.agents.get(agent))) throw badRequest("an agent note needs an agent");
        return indexed(
          store.memories.add({
            scope,
            project_id: scope === "project" ? project : undefined,
            agent_id: scope === "agent" ? agent : undefined,
            text,
            source: "owner",
          }),
        );
      }
      // An agent writes only where it works: never for another project or another agent.
      if (scope === "project" && !view.project_id)
        throw badRequest("this thread has no project; use scope agent or global");
      if ((project && project !== view.project_id) || (agent && agent !== view.agent_id))
        throw unauthorized("an agent writes notes only for its own thread's project or for itself");
      return indexed(
        store.memories.add({
          scope,
          project_id: scope === "project" ? view.project_id : undefined,
          agent_id: scope === "agent" ? view.agent_id : undefined,
          text,
          source: "agent",
          author_agent: view.agent_id,
          thread_id: ctx.agent?.thread_id,
          tainted: tainted ?? true,
        }),
      );
    },

    "memory.remove": ({ id }, ctx) => {
      const m = store.memories.get(id);
      if (!m) return { removed: false };
      const view = viewOf(ctx);
      if (view && (m.source === "owner" || !canSee(view, m)))
        throw unauthorized("an agent can only remove notes agents wrote that it can see");
      return { removed: store.memories.remove(id) };
    },
  } satisfies Partial<Handlers>;
}
