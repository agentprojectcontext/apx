import type { Message, Result, Thread } from "@apx/protocol";
import { EmptyState, IconButton, Icons, SectionLabel, Skeleton } from "@apx/ui";
import { useCallback, useEffect, useMemo, useState } from "react";
import { client } from "../data/client.ts";
import { useData } from "../data/state.ts";
import { useT } from "../i18n/index.ts";
import { go, useNav } from "../shell/nav.ts";
import { type ChangeRow, recordedChanges } from "./change-records.ts";
import { FileChange } from "./FileChange.tsx";
import { PanelHeader } from "./SidePanel.tsx";
import type { Workspace } from "./workspace.ts";

const EMPTY: Message[] = [];

/** One file list for recorded turns and the current repository, without nested summary cards. */
export function ChangesPanel({ thread, ws }: { thread: Thread; ws?: Workspace | undefined }) {
  const t = useT();
  const wide = useNav((s) => s.panelWide);
  const messages = useData((s) => s.messages[thread.id] ?? EMPTY);
  const [selection, setScope] = useState<"latest" | "all" | "folder">();
  const [changes, setChanges] = useState<Result<"files.changes">>();
  const [error, setError] = useState<string>();
  const [version, setVersion] = useState(0);
  const threadId = thread.id;
  const busy = thread.state !== "idle";
  const hasFolder = Boolean(ws);
  const load = useCallback(async () => {
    if (!hasFolder) return;
    try {
      setChanges(await client.call("files.changes", { thread: threadId }));
      setError(undefined);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setVersion((v) => v + 1);
  }, [threadId, hasFolder]);
  const records = useMemo(
    () => recordedChanges(messages, thread.id, selection === "all" ? "all" : "latest"),
    [messages, thread.id, selection],
  );
  const scope = selection ?? (records.length || !hasFolder ? "latest" : "folder");
  useEffect(() => {
    if (scope === "folder" && !busy) void load();
  }, [scope, busy, load]);
  const rows: ChangeRow[] =
    scope === "folder"
      ? (changes?.files ?? []).map((file) => ({ file, cwd: changes?.cwd ?? "", message: "", part: 0, scratch: false }))
      : records;
  const owned = rows.filter((r) => !r.scratch);
  const scratch = rows.filter((r) => r.scratch);
  const list = (items: ChangeRow[]) => (
    <ul className="wchanges__list">
      {items.map((row) => (
        <FileChange
          key={`${row.cwd}:${row.file.path}:${row.message}:${row.part}:${version}`}
          thread={thread.id}
          row={row}
        />
      ))}
    </ul>
  );
  const totals = rows.reduce(
    (n, { file }) => ({ added: n.added + (file.added ?? 0), removed: n.removed + (file.removed ?? 0) }),
    { added: 0, removed: 0 },
  );
  return (
    <>
      <PanelHeader
        actions={
          <IconButton
            label={wide ? t("panel.narrow") : t("panel.widen")}
            icon={wide ? <Icons.Minimize2 size={14} /> : <Icons.Maximize2 size={14} />}
            onClick={() => go.togglePanelWide()}
          />
        }
      >
        <span className="sidepanel__title">
          <Icons.FileDiff size={14} />
          {t(rows.length === 1 ? "changes.heading.one" : "changes.heading.many", { n: rows.length })}
        </span>
      </PanelHeader>
      <div className="sidepanel__body wchanges">
        <div className="wchanges__bar">
          <select
            aria-label={t("changes.scope")}
            value={scope}
            onChange={(e) => setScope(e.target.value as typeof scope)}
            className="wchanges__scope"
          >
            <option value="latest">{t("changes.latest")}</option>
            <option value="all">{t("changes.all")}</option>
            {ws && <option value="folder">{t("changes.folder")}</option>}
          </select>
          <span className="wchanges__spacer" />
          {!!rows.length && (
            <span className="wchanges__stat">
              <span className="wchanges__add">+{totals.added}</span>{" "}
              <span className="wchanges__del">−{totals.removed}</span>
            </span>
          )}
          {scope === "folder" && (
            <IconButton
              size="sm"
              label={t("changes.refresh")}
              icon={<Icons.RefreshCw size={14} />}
              onClick={() => void load()}
            />
          )}
        </div>
        {scope === "folder" && error ? (
          <p className="wchanges__error">{error}</p>
        ) : scope === "folder" && !changes ? (
          <Skeleton className="wchanges__loading" />
        ) : scope === "folder" && !changes?.git ? (
          <EmptyState icon={<Icons.FileDiff />} title={t("changes.noGit")}>
            {t("changes.noGitBody")}
          </EmptyState>
        ) : !rows.length ? (
          <EmptyState
            icon={<Icons.FileDiff />}
            title={t(scope === "folder" ? "changes.none" : "changes.reportedEmpty")}
          />
        ) : (
          <>
            {!!owned.length && list(owned)}
            {!!scratch.length && (
              <section className="wchanges__scratch" aria-label={t("changes.scratch")}>
                <SectionLabel>{t("changes.scratch")}</SectionLabel>
                <p className="wchanges__hint" title={scratch[0]?.cwd}>
                  {t("changes.scratchHint")}
                </p>
                {list(scratch)}
              </section>
            )}
          </>
        )}
      </div>
    </>
  );
}
