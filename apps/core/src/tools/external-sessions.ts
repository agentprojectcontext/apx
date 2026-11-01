import { DEFAULT_AUTONOMY, ModelRef, WritePolicy } from "@apx/protocol";
import { z } from "zod";
import { engineOf } from "../domain/refs.ts";
import type { Store } from "../domain/store.ts";
import { strictestWrite } from "../domain/threads.ts";
import { modeOf, withProjectAutonomy } from "./policy.ts";
import { defineTool, type Tool } from "./types.ts";

const writeOfMode = (mode: string): z.infer<typeof WritePolicy> =>
  mode === "plan" ? "read-only" : mode === "manual" ? "ask" : "auto";

export function externalSessionTools(store: Store): Tool[] {
  return [
    defineTool({
      name: "start_session",
      description:
        "Start a visible external-engine chat. Omit model for engine default, or use engine/model#effort. Answer arrives later; don't poll.",
      args: z.object({
        engine: z.string().min(1).max(80),
        project: z.string().min(1).max(500).optional().describe("id or name; default current"),
        cwd: z.string().max(1024).optional(),
        model: ModelRef.optional(),
        write: WritePolicy.optional(),
        task: z.string().min(1).max(50_000),
      }),
      effect: "external",
      confirm: "always",
      deadlineMs: 15_000,
      when: () => store.projects.list().length > 0,
      title: (a) => `Started a ${a.engine} session`,
      async run(a, ctx) {
        const matches = store.projects
          .list()
          .filter((p) =>
            a.project
              ? p.id === a.project || p.name.toLowerCase() === a.project.toLowerCase()
              : p.id === ctx.thread.project_id,
          );
        if (matches.length !== 1) return "refused: name one registered project by its id or exact, unique name";
        const project = matches[0];
        if (!project) return "refused: no project";
        if (
          (ctx.agent.project_id && project.id !== ctx.agent.project_id) ||
          (ctx.thread.reach === "fenced" && project.id !== ctx.thread.project_id)
        )
          return "refused: this agent cannot start a session in another project";
        if (a.model && engineOf(a.model) !== a.engine) return `refused: model must belong to ${a.engine}`;
        let write = a.write ?? ctx.thread.write ?? "ask";
        if (
          (ctx.thread.write === "read-only" && write !== "read-only") ||
          (ctx.thread.write === "ask" && write === "auto") ||
          (ctx.agent.rules?.write === "off" && write !== "read-only")
        )
          return "refused: a session cannot have more write permission than its caller";
        // A global caller in total mode cannot lift a destination project's ceiling (D-126).
        write = strictestWrite(
          write,
          ctx.thread.write ?? writeOfMode(modeOf(withProjectAutonomy(store, ctx.agent))),
          writeOfMode(project.autonomy ?? DEFAULT_AUTONOMY),
        );
        const thread = await ctx.call("threads.create", {
          kind: "code",
          agent_id: ctx.agent.id,
          project_id: project.id,
          engine: a.engine,
          write,
          ...(a.cwd !== undefined ? { cwd: a.cwd } : {}),
          ...(a.model ? { model: a.model } : {}),
        });
        try {
          const sent = await ctx.call("threads.send", { thread: thread.id, text: a.task });
          ctx.upsertPart((p) => p.type === "subthread" && p.thread_id === thread.id, {
            type: "subthread",
            thread_id: thread.id,
            agent_id: ctx.agent.id,
            title: thread.title,
            state: sent.run.state === "queued" ? "queued" : "working",
          });
          return JSON.stringify({
            thread: thread.id,
            run: sent.run.id,
            engine: a.engine,
            model: a.model ?? "default",
            write,
            state: sent.run.state,
          });
        } catch (err) {
          return `session ${thread.id} was created but not started: ${err instanceof Error ? err.message : String(err)}; do not create a duplicate`;
        }
      },
    }),
  ];
}
