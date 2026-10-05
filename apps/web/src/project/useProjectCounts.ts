// How many agents, chats, open tasks and routines a project has: the counts beside its tabs.
import { useEffect, useMemo } from "react";
import { DEFAULT_PID, inProject, isListed } from "../data/identity.ts";
import { loadRoutines, useRoutines } from "../data/routines.ts";
import { useData } from "../data/state.ts";
import { loadTasks, tasksLoaded, useTasks } from "../data/tasks.ts";
import type { ProjectTab } from "../shell/nav.ts";
import { teamOf } from "./ProjectOverview.tsx";

export function useProjectCounts(pid: string): Partial<Record<ProjectTab, number>> {
  const agents = useData((s) => s.agents);
  const threads = useData((s) => s.threads);
  const tasks = useTasks((s) => s.tasks);
  const tasksReady = useTasks((s) => s.ready);
  const routines = useRoutines((s) => s.routines);
  const routinesReady = useRoutines((s) => s.ready);
  useEffect(() => {
    if (!tasksLoaded()) void loadTasks();
    if (!routinesReady) void loadRoutines();
  }, [routinesReady]);

  return useMemo(() => {
    const here = (p: string | undefined) => (pid === DEFAULT_PID ? !p : p === pid);
    return {
      team: teamOf(agents, pid).length,
      chats: Object.values(threads).filter((t) => isListed(t) && inProject(t, pid)).length,
      ...(tasksReady
        ? { tasks: Object.values(tasks).filter((x) => x.state === "open" && here(x.project_id)).length }
        : {}),
      ...(routinesReady ? { routines: routines.filter((r) => here(r.project_id)).length } : {}),
    };
  }, [agents, threads, tasks, tasksReady, routines, routinesReady, pid]);
}
