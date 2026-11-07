// A task's plan as steps: its agent writes `Task.plan` as a Markdown checklist, so a free-text plan still reads.
// No zod here: the panel reads plans on screens that must not load it.

export type PlanStepState = "pending" | "doing" | "done";
export type PlanStep = { step: string; state: PlanStepState };

const STATE: Record<string, PlanStepState> = { " ": "pending", "~": "doing", x: "done", X: "done" };
const LINE = /^\s*[-*]\s+\[([ ~xX])\]\s+(.+?)\s*$/;

/** The steps of a plan written as `- [x] done`, `- [~] doing`, `- [ ] next`; undefined when any line is something else. */
export function planSteps(plan: string | undefined): PlanStep[] | undefined {
  const lines = (plan ?? "").split("\n").filter((l) => l.trim());
  if (!lines.length) return undefined;
  const steps: PlanStep[] = [];
  for (const line of lines) {
    const m = LINE.exec(line);
    if (!m?.[1] || !m[2]) return undefined;
    steps.push({ step: m[2], state: STATE[m[1]] ?? "pending" });
  }
  return steps;
}
