import { useEffect, useState } from "react";
import { listSecrets } from "../data/resources.ts";

export function useVariableNames(open: boolean, project: string | undefined) {
  const [names, setNames] = useState<string[]>();
  const [failed, setFailed] = useState(false);
  const [request, setRequest] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: request explicitly reloads the same choices
  useEffect(() => {
    if (!open) return;
    let canceled = false;
    setNames(undefined);
    setFailed(false);
    void listSecrets(project, { quiet: true }).then((rows) => {
      if (canceled) return;
      if (!rows) {
        setFailed(true);
        return;
      }
      setNames([...new Set(rows.filter((row) => project || !row.project_id).map((row) => row.name))].sort());
    });
    return () => {
      canceled = true;
    };
  }, [open, project, request]);
  return { names, failed, retry: () => setRequest((n) => n + 1) };
}
