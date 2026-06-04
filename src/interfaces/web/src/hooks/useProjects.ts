import useSWR from "swr";
import { Projects } from "../lib/api";
import { REFRESH } from "../constants";
import type { ProjectEntry } from "../types/daemon";

/** Project list, sorted so the default workspace (id=0) is first. */
export function useProjects() {
  const { data, error, isLoading, mutate } = useSWR<ProjectEntry[]>(
    "/projects",
    () => Projects.list(),
    { refreshInterval: REFRESH.projects },
  );
  const sorted = (data || []).slice().sort((a, b) => {
    const ai = Number(a.id);
    const bi = Number(b.id);
    if (ai === 0 && bi !== 0) return -1;
    if (bi === 0 && ai !== 0) return 1;
    return ai - bi;
  });
  return { projects: sorted, error, isLoading, mutate };
}

export function useProject(pid: string) {
  const { projects, isLoading, mutate } = useProjects();
  const project = projects.find((p) => String(p.id) === pid) ?? null;
  return { project, isLoading, mutate };
}
