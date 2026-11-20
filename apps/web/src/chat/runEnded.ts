import type { Part, RunState } from "@apx/protocol";

type PlanStep = Extract<Part, { type: "plan" }>["steps"][number];
type ToolStatus = Extract<Part, { type: "tool" }>["status"];

/** A run that will not go on: whatever it left under way was cut short, not still working. Unknown is not ended. */
export function runEnded(state: RunState | undefined): boolean {
  return state === "completed" || state === "failed" || state === "canceled";
}

/** A tool call's state as drawn: one still running when its run ended was stopped. */
export function toolStatus(status: ToolStatus, ended: boolean): "running" | "done" | "failed" | "stopped" {
  if (status === "running") return ended ? "stopped" : "running";
  return status === "ok" ? "done" : "failed";
}

/** A plan step's state as drawn: the one under way when its run ended was stopped; the rest keep theirs. */
export function planStatus(state: PlanStep["state"], ended: boolean): "pending" | "running" | "done" | "stopped" {
  if (state === "doing") return ended ? "stopped" : "running";
  return state;
}
