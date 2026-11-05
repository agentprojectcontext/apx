// An outside engine's own checklist (Codex's plan, an ACP agent's plan updates) kept as APX's plan: the same `plan`
// tool call, so its card, the checklist under the answer and a task's plan are what our own loop's would be.
// See DECISIONS.md#d-192
import type { PlanStep } from "@apx/protocol/task-plan";
import { PLAN_CHARS, planText } from "../tools/plan.ts";
import type { TurnIO } from "./types.ts";

const STEP_CHARS = 200;

/** One step as a checklist line holds it: a single line, not too long. */
const oneLine = (s: string) => s.replace(/\s+/g, " ").trim().slice(0, STEP_CHARS);

/**
 * An engine's steps as a checklist the `plan` tool takes, cut at a step within its cap, or nothing when none is left
 * once cleaned.
 */
export function engineChecklist(steps: PlanStep[]): string | undefined {
  const kept: PlanStep[] = [];
  for (const s of steps) {
    const step = oneLine(s.step);
    if (!step) continue;
    if (planText([...kept, { ...s, step }]).length > PLAN_CHARS) break;
    kept.push({ ...s, step });
  }
  return kept.length ? planText(kept) : undefined;
}

/**
 * Sends each new state of the engine's checklist through `plan`, in order and once per change. `settled` waits for
 * the ones still on their way, so the answer is written after its plan.
 */
export function enginePlan(io: Pick<TurnIO, "execute" | "tools" | "run">) {
  const offered = io.tools.some((t) => t.function.name === "plan");
  let last = "";
  let n = 0;
  let chain: Promise<unknown> = Promise.resolve();
  return {
    update(steps: PlanStep[]): void {
      const text = offered ? engineChecklist(steps) : undefined;
      if (!text || text === last) return;
      last = text;
      const callId = `${io.run.id}-plan${++n}`;
      chain = chain.then(() => io.execute(callId, "plan", { steps: text })).catch(() => undefined);
    },
    settled: () => chain,
  };
}
