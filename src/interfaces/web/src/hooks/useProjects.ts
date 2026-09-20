import { useMemo } from "react";
import useSWR from "swr";
import { Projects } from "../lib/api";
import { REFRESH } from "../constants";
import type { ProjectEntry } from "../types/daemon";

/**
 * Project list, sorted so the default workspace (id=0) is first.
 *
 * MEMOISED, and not as an optimisation. `.slice().sort()` on every render
 * handed every caller a new array identity each time, so anything that put
 * `projects` in a dependency array re-ran on every render of its screen rather
 * than when the projects actually changed. A form dialog did exactly that and
 * reset itself under the person filling it in. Tie the identity to the data.
 */
export function useProjects() {
  const { data, error, isLoading, mutate } = useSWR<ProjectEntry[]>(
    "/api/projects",
    () => Projects.list(),
    { refreshInterval: REFRESH.projects },
  );
  const sorted = useMemo(
    () =>
      (data || []).slice().sort((a, b) => {
        const ai = Number(a.id);
        const bi = Number(b.id);
        if (ai === 0 && bi !== 0) return -1;
        if (bi === 0 && ai !== 0) return 1;
        return ai - bi;
      }),
    [data],
  );
  return { projects: sorted, error, isLoading, mutate };
}

export function useProject(pid: string) {
  const { projects, isLoading, mutate } = useProjects();
  const project = projects.find((p) => String(p.id) === pid) ?? null;
  return { project, isLoading, mutate };
}
