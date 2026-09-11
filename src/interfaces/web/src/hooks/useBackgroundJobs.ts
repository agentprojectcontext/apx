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
