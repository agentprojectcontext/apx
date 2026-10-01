// Memory methods. The owner manages every note; an agent reads and writes only where its thread lets it: the owner's
// global notes (read), its thread's project and its own notebook.
import { ErrorCode } from "@apx/protocol";
import { canSee, looksSecret, type MemoryView } from "../domain/memories.ts";
import type { Store } from "../domain/store.ts";
import { CallError } from "../errors.ts";
import type { CallContext } from "./context.ts";
import type { Handler } from "./router.ts";
import { notFound } from "./threads.ts";

const refused = (message: string) => new CallError({ code: ErrorCode.Unauthorized, message });
const bad = (message: string) => new CallError({ code: ErrorCode.BadRequest, message });

export function memoryHandlers(store: Store) {
  /** The agent's view, or undefined for the owner (who sees everything). */
  const viewOf = (ctx: CallContext): MemoryView | undefined => {
    if (ctx.actor === "human") return undefined;
    if (!ctx.agent) throw refused("only the owner or an agent in a thread can use memory");
    return { agent_id: ctx.agent.id, project_id: store.threads.get(ctx.agent.thread_id)?.project_id };
  };

  return {
    "memory.list": (({ query, scope, project, agent, limit }, ctx) => ({
      memories: store.memories.list({ view: viewOf(ctx), scope, project_id: project, agent_id: agent, query, limit }),
    })) as Handler<"memory.list">,

    "memory.add": (({ text, scope, project, agent, id }, ctx) => {
      if (looksSecret(text)) throw bad("that looks like a password, key or token: memory never keeps credentials");
      const view = viewOf(ctx);
      if (id) {
        const m = store.memories.get(id);
        if (!m) throw notFound(`memory ${id}`);
        if (view && (m.source === "owner" || !canSee(view, m)))
          throw refused("an agent can only edit notes agents wrote that it can see");
        return store.memories.edit(id, text) ?? m;
      }
      if (!view) {
        if (scope === "project" && !(project && store.projects.get(project)))
          throw bad("a project note needs a project");
        if (scope === "agent" && !(agent && store.agents.get(agent))) throw bad("an agent note needs an agent");
        return store.memories.add({
          scope,
          project_id: scope === "project" ? project : undefined,
          agent_id: scope === "agent" ? agent : undefined,
          text,
          source: "owner",
        });
      }
      // An agent writes only where it works: never for another project or another agent.
      if (scope === "project" && !view.project_id) throw bad("this thread has no project; use scope agent or global");
      if ((project && project !== view.project_id) || (agent && agent !== view.agent_id))
        throw refused("an agent writes notes only for its own thread's project or for itself");
      return store.memories.add({
        scope,
        project_id: scope === "project" ? view.project_id : undefined,
        agent_id: scope === "agent" ? view.agent_id : undefined,
        text,
        source: "agent",
        author_agent: view.agent_id,
        thread_id: ctx.agent?.thread_id,
      });
    }) as Handler<"memory.add">,

    "memory.remove": (({ id }, ctx) => {
      const m = store.memories.get(id);
      if (!m) return { removed: false };
      const view = viewOf(ctx);
      if (view && (m.source === "owner" || !canSee(view, m)))
        throw refused("an agent can only remove notes agents wrote that it can see");
      return { removed: store.memories.remove(id) };
    }) as Handler<"memory.remove">,
  };
}
