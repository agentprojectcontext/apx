import type { Result } from "@apx/protocol";
import { useCallback, useEffect, useState } from "react";
import { client } from "../data/client.ts";
import type { ChangeRow } from "./change-records.ts";

export type LoadedDiff = Result<"files.diff"> | { error: string };

/** A changed file's diff: the one its turn recorded, else read from the core once `wanted`. */
export function useFileDiff(thread: string, row: ChangeRow, wanted: boolean) {
  const { file } = row;
  const [loaded, setLoaded] = useState<LoadedDiff>();
  const [loading, setLoading] = useState(false);
  const diff: LoadedDiff | undefined =
    file.diff === undefined
      ? loaded
      : { path: file.path, diff: file.diff, truncated: file.truncated ?? false, source: "recorded" };
  const load = useCallback(() => {
    setLoading(true);
    client
      .call("files.diff", { thread, path: file.path, ...(row.message ? { message: row.message, part: row.part } : {}) })
      .then(setLoaded)
      .catch((e: unknown) => setLoaded({ error: e instanceof Error ? e.message : String(e) }))
      .finally(() => setLoading(false));
  }, [thread, file.path, row.message, row.part]);
  useEffect(() => {
    if (file.diff !== undefined) setLoaded(undefined);
  }, [file.diff]);
  useEffect(() => {
    if (wanted && !diff && !loading) load();
  }, [wanted, diff, loading, load]);
  return { diff, loading, load };
}
