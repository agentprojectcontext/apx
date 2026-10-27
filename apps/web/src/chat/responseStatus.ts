import type { RunEndReason, RunState } from "@apx/protocol";
import type { MessageKey } from "../i18n/index.ts";

type Report = { state: RunState; end_reason?: RunEndReason; issue?: "no_answer" | "actions_failed" };
const STATE: Record<RunState, { status: "waiting" | "running" | "done" | "failed"; label: MessageKey }> = {
  queued: { status: "waiting", label: "run.queued" },
  submitted: { status: "running", label: "run.submitted" },
  working: { status: "running", label: "run.working" },
  "input-required": { status: "waiting", label: "run.waiting" },
  completed: { status: "done", label: "run.done" },
  failed: { status: "failed", label: "run.failed" },
  canceled: { status: "failed", label: "run.canceled" },
};

export function responseStatus(report: Report): {
  status: "waiting" | "running" | "done" | "failed";
  label: MessageKey;
} {
  if (report.end_reason === "step_limit") return { status: "waiting", label: "usage.state.stepLimit" };
  if (report.end_reason === "deadline") return { status: "waiting", label: "usage.state.outOfTime" };
  if (report.issue === "no_answer") return { status: "waiting", label: "subthread.noAnswer" };
  if (report.issue === "actions_failed") return { status: "waiting", label: "subthread.actionsFailed" };
  return STATE[report.state];
}

export function responseTitle(report: Report): MessageKey {
  if (report.end_reason === "step_limit" || report.end_reason === "deadline") return "chat.agentProgress";
  return report.state === "completed" && report.issue !== "no_answer" ? "chat.agentResponse" : "chat.agentMessage";
}
