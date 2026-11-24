import "../styles/panel-parts.css";
import { Button, IconButton, Icons, Skeleton, Tooltip } from "@apx/ui";
import { useEffect, useRef, useState } from "react";
import { useT } from "../i18n/index.ts";
import { go } from "../shell/nav.ts";
import type { ChangeRow } from "./change-records.ts";
import { DiffView } from "./DiffView.tsx";
import { useFileDiff } from "./useFileDiff.ts";

/**
 * A changed file: its row unfolds a quick look at what changed; `onOpen` shows the whole file with its changes in a tab.
 * Asked for from the chat (`focus`), it unfolds and comes into view.
 */
export function FileChange({
  thread,
  row,
  focus,
  onOpen,
}: {
  thread: string;
  row: ChangeRow;
  focus?: object | undefined;
  onOpen(row: ChangeRow): void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (!focus) return;
    setOpen(true);
    ref.current?.scrollIntoView({ block: "nearest" });
  }, [focus]);
  const { file } = row;
  const { diff, loading, load } = useFileDiff(thread, row, open);
  const toggle = () => {
    setOpen((value) => !value);
  };
  return (
    <li ref={ref} className={open ? "wchanges__file is-open" : "wchanges__file"}>
      <div className="wchanges__head">
        <Tooltip content={file.path}>
          <button type="button" className="wchanges__row" aria-expanded={open} onClick={toggle}>
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
        </Tooltip>
        <IconButton
          size="sm"
          className="wchanges__view"
          label={t("changes.openTab")}
          icon={<Icons.FileDiff size={14} />}
          onClick={() => onOpen(row)}
        />
        {!file.status.includes("D") && (
          <IconButton
            size="sm"
            className="wchanges__view"
            label={t("changes.viewFile")}
            icon={<Icons.Eye size={14} />}
            onClick={() => go.file({ cwd: row.cwd, path: file.path, scratch: row.scratch })}
          />
        )}
      </div>
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
