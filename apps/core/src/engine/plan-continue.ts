// A chat working its own plan (no task) goes on when a result reached it and its turn only reported: "analysis in,
// I'll implement next" with nothing running is a stop, not a step (DECISIONS.md#d-232).
import type { RunRecord } from "../domain/runs.ts";
import type { Store } from "../domain/store.ts";
import { agentTrip, trip } from "./breaker.ts";
import type { AdmitFn } from "./engine.ts";
import { answerOf } from "./run-outcome.ts";
import { awaiting } from "./task-continue.ts";

const RESULTS = new Set(["delegation_result", "delegation_results", "task_result", "workflow_result"]);

/** The plan this chat's agent last wrote, when a step is still left. */
function openPlan(store: Store, threadId: string): boolean {
  const part = store.messages.latestPart(threadId, "plan");
  return part?.type === "plan" && part.steps.some((s) => s.state !== "done");
}

/** Starts one more turn for `run`'s chat plan when a result turn only talked and nothing else is to come. */
export function continuePlan(store: Store, admit: AdmitFn, run: RunRecord): RunRecord | undefined {
  if (run.state !== "completed" || !RESULTS.has(run.input?.origin.kind ?? "")) return undefined;
  const thread = store.threads.get(run.thread_id);
  // A task's chat goes on through the task (task-continue.ts).
  if (!thread || thread.task_id || !openPlan(store, thread.id)) return undefined;
  // It acted (delegated the next part, worked on it) or asked the owner something: that is its next step.
  if (store.runs.steps(run.id).some((s) => s.tool !== "plan")) return undefined;
  const answer = answerOf(store, run)?.trim();
  if (!answer || /[?？]\s*$/.test(answer)) return undefined;
  if (store.runs.nextQueued(thread.id) || awaiting(store, thread.id)) return undefined;
  if (trip(store, thread.id) || agentTrip(store, thread.id, run.agent_id)) return undefined;
  return admit({
    thread_id: thread.id,
    agent_id: run.agent_id,
    trigger: "system",
    origin: { kind: "plan_continue", from_run: run.id },
    text: "",
    reply_to: run.input?.reply_to,
  });
}
