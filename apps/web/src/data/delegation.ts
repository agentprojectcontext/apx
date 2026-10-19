import type { Run, Thread } from "@apx/protocol";
import { t } from "../i18n/index.ts";
import { client } from "./client.ts";
import { data } from "./state.ts";

const reads = new Map<string, Promise<void>>();
const observed = new Map<string, number>();

export function observeDelegation(thread: string): () => void {
  observed.set(thread, (observed.get(thread) ?? 0) + 1);
  return () => {
    const left = (observed.get(thread) ?? 1) - 1;
    if (left) observed.set(thread, left);
    else observed.delete(thread);
  };
}

/** Sequence gaps, focus and reconnect revalidate visible notices even when their sessions were never opened. */
export async function refetchDelegations(): Promise<void> {
  // A deleted or inaccessible session must not take the whole panel offline during reconnect.
  await Promise.allSettled([...observed.keys()].map((id) => refreshDelegation(id, true)));
}

/** Read old sessions too, without replacing events received while the request was pending. */
export function refreshDelegation(thread: string, force = false): Promise<void> {
  const existing = reads.get(thread);
  if (existing && !force) return existing;
  const before = data.get();
  const pending = client
    .call("threads.get", { thread })
    .then((r) => {
      if (reads.get(thread) !== pending) return;
      data.set((s) => ({
        threads: s.threads[thread] === before.threads[thread] ? { ...s.threads, [thread]: r.thread } : s.threads,
        runs: {
          ...s.runs,
          ...Object.fromEntries(
            r.runs.filter((run) => s.runs[run.id] === before.runs[run.id]).map((run) => [run.id, run]),
          ),
        },
      }));
    })
    .finally(() => {
      if (reads.get(thread) === pending) reads.delete(thread);
    });
  reads.set(thread, pending);
  return pending;
}

export function latestDelegatedRun(runs: Record<string, Run>, thread: string): Run | undefined {
  return Object.values(runs)
    .filter((r) => r.thread_id === thread)
    .sort((a, b) => b.started_at.localeCompare(a.started_at) || Number(!b.ended_at) - Number(!a.ended_at))[0];
}

export type DelegationState = "loading" | "working" | "queued" | "waiting" | "stopped" | "completed";

export function delegationState(thread: Thread | undefined, run: Run | undefined): DelegationState {
  if (!thread || !run) return "loading";
  if (thread.state === "working" || thread.state === "submitted") return "working";
  if (thread.state === "queued") return "queued";
  if (thread.state === "input-required") return "waiting";
  return run.state === "completed" && run.end_reason !== "step_limit" && run.end_reason !== "deadline"
    ? "completed"
    : "stopped";
}

/** The core checks the run again atomically, so another click cannot queue a duplicate or interrupt new work. */
export async function continueDelegation(thread: string, run: string): Promise<void> {
  const result = await client.call("threads.send", {
    thread,
    text: t("notice.delegation.limit.continuePrompt"),
    mode: "queue",
    continue_run: run,
  });
  data.set((s) => ({ runs: { ...s.runs, [result.run.id]: s.runs[result.run.id] ?? result.run } }));
  await refreshDelegation(thread);
}
