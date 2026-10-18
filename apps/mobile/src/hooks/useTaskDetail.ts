import { useCallback, useEffect, useMemo, useState } from "react";
import type { TaskEvent } from "../protocol";
import type { TaskComment } from "../tasks/comments";
import type { TaskUsage, Thread } from "./useWorkspace";

type TaskDetail = {
  events: TaskEvent[];
  comments: TaskComment[];
  sessions: Thread[];
  usage?: TaskUsage[];
};

export function useTaskDetail(
  taskId: string | undefined,
  activity: string | undefined,
  load: (id: string) => Promise<TaskDetail>,
) {
  const [loaded, setLoaded] = useState<{ taskId: string; value: TaskDetail }>();
  const scope = useMemo(() => ({ active: false, sequence: 0, load, taskId, activity }), [load, taskId, activity]);
  const reload = useCallback(() => {
    const { taskId, load } = scope;
    if (!taskId || !scope.active) return;
    const sequence = ++scope.sequence;
    void load(taskId)
      .then((value) => {
        if (scope.active && sequence === scope.sequence) setLoaded({ taskId, value });
      })
      .catch(() => {
        if (!scope.active || sequence !== scope.sequence) return;
        setLoaded((now) =>
          now?.taskId === taskId ? now : { taskId, value: { events: [], comments: [], sessions: [] } },
        );
      });
  }, [scope]);
  useEffect(() => {
    scope.active = true;
    reload();
    return () => {
      scope.active = false;
      scope.sequence++;
    };
  }, [reload, scope]);
  return { detail: loaded?.taskId === taskId ? loaded?.value : undefined, reload };
}
