import type { Result } from "@apx/protocol";
import { Button, Icons, Skeleton } from "@apx/ui";
import { useCallback, useEffect, useState } from "react";
import { client } from "../data/client.ts";
import { useT } from "../i18n/index.ts";
import type { ChangeRow } from "./change-records.ts";
import { DiffView } from "./DiffView.tsx";

export function FileChange({ thread, row }: { thread: string; row: ChangeRow }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const { file } = row;
  const [loadedDiff, setDiff] = useState<Result<"files.diff"> | { error: string }>();
  const diff =
    file.diff === undefined
      ? loadedDiff
      : { path: file.path, diff: file.diff, truncated: file.truncated ?? false, source: "recorded" as const };
  const [loading, setLoading] = useState(false);
  const load = useCallback(() => {
    setLoading(true);
    client
      .call("files.diff", { thread, path: file.path, ...(row.message ? { message: row.message, part: row.part } : {}) })
      .then(setDiff)
      .catch((e: unknown) => setDiff({ error: e instanceof Error ? e.message : String(e) }))
      .finally(() => setLoading(false));
  }, [thread, file.path, row.message, row.part]);
  useEffect(() => {
    if (file.diff !== undefined) setDiff(undefined);
  }, [file.diff]);
  useEffect(() => {
    if (open && !diff && !loading) load();
  }, [open, diff, loading, load]);
  const toggle = () => {
    setOpen((value) => !value);
  };
  return (
    <li className={open ? "wchanges__file is-open" : "wchanges__file"}>
      <button type="button" className="wchanges__row" aria-expanded={open} onClick={toggle} title={file.path}>
        {open ? <Icons.ChevronDown size={14} /> : <Icons.ChevronRight size={14} />}
        <Icons.FileText size={14} />
        <span className="wchanges__path">{file.path}</span>
        <span className="wchanges__spacer" />
        {file.status === "??" || file.status === "A" ? (
          <span className="wchanges__badge">{t("changes.new")}</span>
        ) : file.status.includes("D") ? (
          <span className="wchanges__badge">{t("changes.deleted")}</span>
        ) : null}
        {file.added != null && <span className="wchanges__add">+{file.added}</span>}
        {file.removed != null && <span className="wchanges__del">−{file.removed}</span>}
      </button>
      {open &&
        (loading || !diff ? (
          <Skeleton className="wchanges__loading" />
        ) : "error" in diff ? (
          <div className="wchanges__error">
            <p>{diff.error}</p>
            <Button size="sm" variant="ghost" onClick={load}>
              {t("changes.refresh")}
            </Button>
          </div>
        ) : (
          <DiffView text={diff.diff} truncated={diff.truncated} current={diff.source === "current"} />
        ))}
    </li>
  );
}
