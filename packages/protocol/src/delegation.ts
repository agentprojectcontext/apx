// Where a delegated session stands now, for the actions on its limit notice: the notice records a past limit, its
// buttons follow the session (DECISIONS.md#d-105). Pure and zod-free, so the panel and the phone load it alike.

/** What the state reads of a session's thread and runs: the phone keeps its own looser copies of the types. */
type SessionThread = { state: string };
type SessionRun = {
  id: string;
  thread_id: string;
  started_at: string;
  ended_at?: string | null | undefined;
  state: string;
  end_reason?: string | null | undefined;
};

/** The session's newest run, a running one first when two started together. */
export function latestDelegatedRun<R extends SessionRun>(
  runs: Record<string, R> | readonly R[],
  thread: string,
): R | undefined {
  return Object.values(runs)
    .filter((r) => r.thread_id === thread)
    .sort((a, b) => b.started_at.localeCompare(a.started_at) || Number(!b.ended_at) - Number(!a.ended_at))[0];
}

export type DelegationState = "loading" | "working" | "queued" | "waiting" | "stopped" | "completed";

/** Working, queued or waiting on a question; else stopped (a limit, a deadline, cancelled) or completed. */
export function delegationState(thread: SessionThread | undefined, run: SessionRun | undefined): DelegationState {
  if (!thread || !run) return "loading";
  if (thread.state === "working" || thread.state === "submitted") return "working";
  if (thread.state === "queued") return "queued";
  if (thread.state === "input-required") return "waiting";
  return run.state === "completed" && run.end_reason !== "step_limit" && run.end_reason !== "deadline"
    ? "completed"
    : "stopped";
}
