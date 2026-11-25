// The `workflow` tool: a plan of delegations that code runs, shown on one live card (DECISIONS.md#d-272).
import { z } from "zod";
import { worksForOwner } from "../domain/owner-work.ts";
import type { Store } from "../domain/store.ts";
import { Item, MAX_ITEMS, MAX_PARALLEL, MAX_STAGES, Stage, WorkflowPlan } from "../domain/workflow-plan.ts";
import { midPlan } from "./agents.ts";
import { defineTool, type Tool, ToolFailed } from "./types.ts";

export function workflowTool(store: Store): Tool {
  return defineTool({
    name: "workflow",
    description:
      "Run a plan of agent calls that code moves forward, on a live card the owner can stop. Each of `items` goes through `stages` in order without waiting for the other items; up to `parallel` agents work at once. A stage names an agent or a worker, the phase it shows under and a task with {{item}}, {{item.field}} and {{previous}} (that item's last output); `output` (a JSON schema) makes its answer JSON that later stages read; `only_if` keeps an item going only while a field of the previous output is true. `finish` runs once with {{results}}. For wide fan-outs and check-after-search work; one question goes to delegate. `resume`: a stopped or failed one's id, keeping what is done.",
    args: z.object({
      name: z.string().max(80).optional(),
      items: z.array(Item).max(MAX_ITEMS).optional(),
      stages: z.array(Stage).max(MAX_STAGES).optional(),
      finish: Stage.omit({ only_if: true }).optional(),
      parallel: z.number().int().min(1).max(MAX_PARALLEL).optional().describe("default 3"),
      resume: z.string().max(60).optional(),
      wait_s: z.number().int().min(0).max(120).optional().describe("seconds to wait inside this turn (default 60)"),
    }),
    effect: "message",
    deadlineMs: 130_000,
    cut: "The workflow keeps running; its result comes back in a new turn: do not start it again.",
    title: (a) => (a.resume ? `Resumed workflow ${String(a.resume)}` : `Started workflow ${String(a.name ?? "")}`),
    async run(a, ctx) {
      if (!ctx.workflow) return "refused: workflows run only from your own turns, not while answering another agent";
      const early = midPlan(store, ctx.thread.task_id, ctx.agent.id, ctx.run.id);
      if (early && !worksForOwner(store, ctx.thread)) throw new ToolFailed(early);
      const waitMs = (a.wait_s ?? 60) * 1000;
      if (a.resume) return ctx.workflow({ resume: a.resume }, waitMs, ctx.signal);
      const plan = WorkflowPlan.safeParse({
        name: a.name,
        items: a.items,
        stages: a.stages,
        finish: a.finish,
        parallel: a.parallel,
      });
      if (!plan.success)
        throw new ToolFailed(
          `the plan does not fit: ${plan.error.issues.map((i) => `${i.path.join(".") || "plan"}: ${i.message}`).join("; ")}`,
        );
      for (const stage of [...plan.data.stages, ...(plan.data.finish ? [plan.data.finish] : [])]) {
        if (!stage.agent) continue;
        const found = store.agents.resolve(stage.agent, ctx.thread.project_id);
        if ("error" in found) throw new ToolFailed(`stage ${stage.phase}: ${found.error}`);
        if (found.agent.id === ctx.agent.id)
          throw new ToolFailed(`stage ${stage.phase}: use a worker for work of your own, not your own name`);
      }
      return ctx.workflow({ plan: plan.data }, waitMs, ctx.signal);
    },
  });
}
