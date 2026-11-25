// Workflows an agent started (DECISIONS.md#d-273): the owner reads, stops and resumes any; the owner's agents those of a
// chat they can read; another agent only its own chat's.
import { canReadChat } from "../domain/chat-access.ts";
import { ownerAgentOf } from "../domain/owner-work.ts";
import type { Store } from "../domain/store.ts";
import type { Engine } from "../engine/engine.ts";
import { notFound, unauthorized } from "../errors.ts";
import type { CallContext } from "./context.ts";
import type { Handlers } from "./router.ts";

export function workflowHandlers(store: Store, engine: Engine) {
  /** The workflow, when this caller may act on it. */
  const reach = (id: string, ctx: CallContext) => {
    const w = store.workflows.get(id);
    if (!w) throw notFound(`workflow ${id}`);
    if (ctx.actor === "human" || ctx.agent?.thread_id === w.thread_id) return w;
    const agent = ownerAgentOf(store, ctx);
    const thread = store.threads.get(w.thread_id);
    if (agent && thread && canReadChat(store, agent, thread)) return w;
    throw unauthorized("an agent can only reach the workflows of a chat it can read");
  };
  return {
    "workflows.get": ({ workflow }, ctx) => {
      reach(workflow, ctx);
      const found = engine.workflows.get(workflow);
      if (!found) throw notFound(`workflow ${workflow}`);
      return found;
    },
    "workflows.stop": ({ workflow }, ctx) => {
      reach(workflow, ctx);
      return { stopped: engine.workflows.stop(workflow) };
    },
    "workflows.resume": async ({ workflow }, ctx) => {
      const w = reach(workflow, ctx);
      if (w.state === "running" || w.state === "done") return { resumed: false };
      await engine.workflows.resume(workflow);
      return { resumed: store.workflows.get(workflow)?.state === "running" };
    },
  } satisfies Partial<Handlers>;
}
