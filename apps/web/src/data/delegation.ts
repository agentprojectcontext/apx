import { t } from "../i18n/index.ts";
import { client } from "./client.ts";
import { watchDelegation } from "./delegationWatch.ts";
import { data } from "./state.ts";

const reads = new Map<string, Promise<void>>();

export { refetchDelegations } from "./delegationWatch.ts";

export function observeDelegation(thread: string): () => void {
  return watchDelegation(thread, () => refreshDelegation(thread, true));
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

export { type DelegationState, delegationState, latestDelegatedRun } from "@apx/protocol/delegation";

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
