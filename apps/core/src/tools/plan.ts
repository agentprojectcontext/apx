// plan: the agent's checklist for multi-step work, shown live under its answer; in a task's chat it is the task's plan.
import type { Part, Thread } from "@apx/protocol";
import { type PlanStep, planSteps } from "@apx/protocol/task-plan";
import { z } from "zod";
import type { Store } from "../domain/store.ts";
import { badRequest } from "../errors.ts";
import { fromTeam } from "./result.ts";
import { defineTool, type Tool } from "./types.ts";

/** All a plan may hold: the same cap a task's plan has (tasks.update). */
const PLAN_CHARS = 4000;
const MARK: Record<PlanStep["state"], string> = { pending: " ", doing: "~", done: "x" };

/** How far a plan the agent sent is: steps done and all of them, for its card's title. */
export function planProgress(text: unknown): { done: number; count: number } {
  const steps = planSteps(String(text ?? "")) ?? [];
  return { done: steps.filter((s) => s.state === "done").length, count: steps.length };
}

/** A plan's steps written back as the checklist the agent reads. */
export const planText = (steps: PlanStep[]) => steps.map((s) => `- [${MARK[s.state]}] ${s.step}`).join("\n");

/**
 * The chat's plan for its next turn while a step is left: the latest one its agent wrote, from the answers it is shown
 * in, so it outlives a summary of the chat. A task's chat reads the task's plan in its task block instead.
 */
export function chatPlanBlock(store: Store, thread: Pick<Thread, "id" | "task_id">): string | undefined {
  if (thread.task_id) return undefined;
  const part = store.messages.latestPart(thread.id, "plan");
  if (part?.type !== "plan" || part.steps.every((s) => s.state === "done")) return undefined;
  // The agent's own words in this chat: the owner's side, never outside content (DECISIONS.md#d-191).
  return fromTeam("chat_plan", {}, planText(part.steps));
}

export function planTools(): Tool[] {
  return [
    defineTool({
      name: "plan",
      description:
        "Your plan for work of more than two steps, shown to the owner as a checklist: all steps, marked as you go (- [x] done, - [~] doing, - [ ] next).",
      args: z.object({ steps: z.string().max(PLAN_CHARS) }),
      // A checklist of what the agent does: it changes nothing of the owner's, so no mode stops it.
      effect: "none",
      check: (a) => {
        if (!planSteps(a.steps)) throw badRequest("steps: one line per step, each - [ ] , - [~] or - [x] and the step");
      },
      deadlineMs: 5_000,
      title: (a) => {
        const { done, count } = planProgress(a.steps);
        return `Plan: ${done} of ${count} done`;
      },
      async run(a, ctx) {
        const steps = planSteps(a.steps) ?? [];
        // One plan per task chat: the task keeps it, for its drawer and its progress guard (DECISIONS.md#d-188).
        if (ctx.thread.task_id) await ctx.call("tasks.update", { task: ctx.thread.task_id, plan: planText(steps) });
        const part: Part = { type: "plan", steps };
        ctx.upsertPart((p) => p.type === "plan", part, { last: true });
        const left = steps.filter((s) => s.state !== "done").length;
        return left ? `plan kept: ${left} step(s) left.` : "plan kept: every step done.";
      },
    }),
  ];
}
