import type { Store } from "../domain/store.ts";
import { badRequest, notFound } from "../errors.ts";
import type { Asana } from "../integrations/asana.ts";
import type { CallContext } from "./context.ts";
import type { Handlers } from "./router.ts";

export function asanaHandlers(store: Store, asana: Asana) {
  const check = (project: string | undefined, ctx: CallContext) => {
    if (ctx.agent) {
      const thread = store.threads.get(ctx.agent.thread_id);
      if (!thread || thread.project_id !== project) throw badRequest("Asana project must match the current chat");
      if (store.threads.context(thread.id).client) throw badRequest("Asana is for the owner's chats");
    }
    if (project && !store.projects.get(project)) throw notFound(`project ${project}`);
    if (!asana.usable(project)) throw badRequest("Asana is disconnected or disabled in this project");
  };
  return {
    "asana.read": async ({ project, request }, ctx) => {
      check(project, ctx);
      return asana.read(request);
    },
    "asana.write": async ({ project, request }, ctx) => {
      check(project, ctx);
      return asana.write(request);
    },
  } satisfies Partial<Handlers>;
}
