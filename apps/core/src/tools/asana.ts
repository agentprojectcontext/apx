import { AsanaRead, AsanaWrite } from "@apx/protocol";
import { z } from "zod";
import type { Store } from "../domain/store.ts";
import type { Asana } from "../integrations/asana.ts";
import { untrusted } from "./result.ts";
import { defineTool, type Tool } from "./types.ts";

export function asanaTools(asana: Asana, store: Store): Tool[] {
  // A contact's chat is refused by the handler anyway: not offering the tools there spares their schemas.
  const offered = (thread: { id: string; project_id?: string | undefined }) =>
    asana.usable(thread.project_id) && !store.threads.context(thread.id).client;
  return [
    defineTool({
      name: "asana_read",
      description:
        "Read Asana workspaces, projects, tasks or one task. Paginate with the returned next_offset. Project means an Asana project gid.",
      args: z.object({ request: AsanaRead }),
      effect: "none",
      deadlineMs: 30_000,
      when: offered,
      title: () => "Read Asana",
      async run(args, ctx) {
        const result = await ctx.call("asana.read", { project: ctx.thread.project_id, ...args });
        return untrusted("asana", {}, JSON.stringify(result));
      },
    }),
    defineTool({
      name: "asana_write",
      description:
        "Create or update an Asana task as the owner. Project means an Asana project gid. Requires approval; never retry a create with unknown outcome.",
      args: z.object({ request: AsanaWrite }),
      effect: "external",
      confirm: "always",
      deadlineMs: 30_000,
      when: offered,
      title: () => "Change an Asana task",
      async run(args, ctx) {
        if (!ctx.callAsOwner) throw new Error("Asana writes require owner approval");
        const result = await ctx.callAsOwner("asana.write", { project: ctx.thread.project_id, ...args });
        return untrusted("asana", {}, JSON.stringify(result));
      },
    }),
  ];
}
