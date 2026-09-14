import { useEffect } from "react";
import useSWR from "swr";
import { JobsApi } from "../lib/api/jobs";
import { subscribeBackgroundJobs } from "../lib/live";
import type { BackgroundJob } from "../types/daemon";

/**
 * Work agents left running, kept current without polling.
 *
 * One fetch for what is already open when the screen mounts, then the live feed
 * for every job that starts or ends after that. Both halves are needed: the feed
 * only carries changes, so a panel opened while a job was already running would
 * show nothing until that job ended — which is precisely the window that
 * matters.
 *
 * Scoped to a project when given one. The revalidation key carries the scope so
 * two screens watching different projects do not share a cache entry.
 */
export function useBackgroundJobs(projectId?: string | number | null) {
  const key = projectId == null ? "/api/jobs?open=1" : `/api/jobs?open=1&project_id=${projectId}`;
  const { data, error, isLoading, mutate } = useSWR<{ data: BackgroundJob[]; meta: { open: number } }>(
    key,
    () => JobsApi.list({ open: true, projectId: projectId ?? undefined }),
  );

  useEffect(
    () =>
      subscribeBackgroundJobs((frame) => {
        // A frame for another project is not this screen's business. The daemon
        // broadcasts to every client; the filter belongs here.
        if (projectId != null && String(frame.project_id) !== String(projectId)) return;
        // Progress is not a state change: the job was running before the frame
        // and is running after it, and the frame already carries the record. So
        // the cache is patched in place with no request — a render printing
        // every second would otherwise mean a round-trip every two, per open
        // panel, per device, forever.
        if (frame.phase === "progress") {
          void mutate(
            (cur) =>
              cur
                ? { ...cur, data: cur.data.map((j) => (j.id === frame.job.id ? frame.job : j)) }
                : cur,
            { revalidate: false },
          );
          return;
        }
        mutate();
      }),
    [projectId, mutate],
  );

  return {
    jobs: data?.data ?? [],
    open: data?.data?.length ?? 0,
    error,
    isLoading,
    mutate,
  };
}

/**
 * Is an agent running work it started from THIS thread?
 *
 * A background job is an a2a exchange, so its `thread` is the pair id a chat
 * row is keyed by — which means the row already knows enough to say "somebody
 * is working on something here", and said nothing. Manu, 2026-09-14, watching
 * a peer he had handed work to: "ahí apareció magui hablando — o sea estaba
 * haciendo algo pero no lo decía el chat."
 *
 * Deliberately unscoped: every row asks the same SWR key, so the list costs ONE
 * request however long it is, and a row for another project still answers
 * correctly instead of reading an empty project-scoped cache.
 */
export function useThreadJobRunning(threadId?: string | null, conversationId?: string | null): boolean {
  const { jobs } = useBackgroundJobs();
  if (!threadId && !conversationId) return false;
  return jobs.some(
    (j) =>
      (!!threadId && j.thread === threadId) ||
      // A shell job has no pair thread — it belongs to the CHAT it was launched
      // from, and that row deserves the same mark for the same reason: from
      // outside, an agent with a render running looks like an agent doing
      // nothing.
      (!!conversationId && j.origin?.conversation_id === conversationId),
  );
}
