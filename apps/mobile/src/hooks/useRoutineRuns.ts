import { useEffect, useMemo, useState } from "react";
import type { RoutineRun } from "../protocol";
import type { Routine } from "./useWorkspace";

/** Reload on run transitions; responses belong to the routine and refresh that requested them. */
export function useRoutineRuns(
  routine: Routine,
  load: (id: string, limit?: number) => Promise<RoutineRun[]>,
  limit = 14,
) {
  const [loaded, setLoaded] = useState<{ id: string; runs: RoutineRun[] }>();
  const id = routine.id;
  const latest = `${routine.last?.run_id}:${routine.last?.state}`;
  const query = useMemo(() => ({ id, load, limit, latest }), [id, load, limit, latest]);
  useEffect(() => {
    let live = true;
    void query
      .load(query.id, query.limit)
      .then((runs) => {
        if (live) setLoaded({ id: query.id, runs });
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [query]);
  return loaded?.id === id ? loaded.runs : [];
}
