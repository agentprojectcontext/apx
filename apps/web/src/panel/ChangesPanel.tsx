import type { ChangedFile, Result } from "@apx/protocol";
import { EmptyState, IconButton, Icons, Skeleton } from "@apx/ui";
import { useCallback, useEffect, useState } from "react";
import { client } from "../data/client.ts";
import { useT } from "../i18n/index.ts";
import { ReportedChangesPanel } from "./ReportedChangesPanel.tsx";
import type { Workspace } from "./workspace.ts";

type Changes = Result<"files.changes">;

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * What is uncommitted in the chat's folder, per git: one row per file with its lines added and removed, unfolding into
 * its diff. Read again when the agent finishes a turn and on demand.
 */
export function ChangesPanel({ ws }: { ws: Workspace }) {
  const t = useT();
  const [changes, setChanges] = useState<Changes>();
  const [error, setError] = useState<string>();
  const [version, setVersion] = useState(0);
  const threadId = ws.thread.id;
  const busy = ws.thread.state !== "idle";
  const load = useCallback(async () => {
    try {
      setChanges(await client.call("files.changes", { thread: threadId }));
      setError(undefined);
    } catch (e) {
      setError(errText(e));
    }
    setVersion((v) => v + 1);
  }, [threadId]);
  // Again whenever a turn ends: that is when the agent's edits are done.
  useEffect(() => {
    if (!busy) void load();
  }, [busy, load]);

  const totals = (changes?.files ?? []).reduce(
    (n, f) => ({ added: n.added + (f.added ?? 0), removed: n.removed + (f.removed ?? 0) }),
    { added: 0, removed: 0 },
  );
  return (
    <div className="sidepanel__body wchanges">
      <div className="wchanges__bar">
        <span className="wchanges__where" title={changes?.cwd ?? ws.folder}>
          {t("changes.where", { n: changes?.files.length ?? 0 })}
        </span>
        {changes && changes.files.length > 0 && (
          <span className="wchanges__stat">
            <span className="wchanges__add">+{totals.added}</span>{" "}
            <span className="wchanges__del">−{totals.removed}</span>
          </span>
        )}
        <IconButton
          size="sm"
          label={t("changes.refresh")}
          icon={<Icons.RefreshCw size={14} />}
          onClick={() => void load()}
        />
      </div>
      <ReportedChangesPanel thread={ws.thread} embedded />
      {error ? (
        <p className="wchanges__error">{error}</p>
      ) : !changes ? (
        <Skeleton className="wchanges__loading" />
      ) : !changes.git ? (
        <EmptyState icon={<Icons.FileDiff />} title={t("changes.noGit")}>
          {t("changes.noGitBody")}
        </EmptyState>
      ) : !changes.files.length ? (
        <EmptyState icon={<Icons.FileDiff />} title={t("changes.none")}>
          {t("changes.noneBody")}
        </EmptyState>
      ) : (
        <ul className="wchanges__list">
          {changes.files.map((f) => (
            <FileChange key={`${f.path}:${version}`} thread={threadId} file={f} />
          ))}
        </ul>
      )}
    </div>
  );
}

/** One file: a folding row, its diff read the first time it opens. */
function FileChange({ thread, file }: { thread: string; file: ChangedFile }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [diff, setDiff] = useState<Result<"files.diff"> | { error: string }>();
  const slash = file.path.lastIndexOf("/");
  const name = file.path.slice(slash + 1);
  const dir = slash > 0 ? file.path.slice(0, slash) : "";
  const toggle = () => {
    setOpen((o) => !o);
    if (!diff)
      client
        .call("files.diff", { thread, path: file.path })
        .then(setDiff)
        .catch((e: unknown) => setDiff({ error: errText(e) }));
  };
  return (
    <li className={open ? "wchanges__file is-open" : "wchanges__file"}>
      <button type="button" className="wchanges__row" aria-expanded={open} onClick={toggle}>
        {open ? <Icons.ChevronDown size={14} /> : <Icons.ChevronRight size={14} />}
        <span className="wchanges__name">{name}</span>
        {dir && <span className="wchanges__dir">{dir}</span>}
        <span className="wchanges__spacer" />
        {file.status === "??" ? (
          <span className="wchanges__badge">{t("changes.new")}</span>
        ) : file.status.includes("D") ? (
          <span className="wchanges__badge">{t("changes.deleted")}</span>
        ) : null}
        {file.added != null && <span className="wchanges__add">+{file.added}</span>}
        {file.removed != null && <span className="wchanges__del">−{file.removed}</span>}
      </button>
      {open &&
        (!diff ? (
          <Skeleton className="wchanges__loading" />
        ) : "error" in diff ? (
          <p className="wchanges__error">{diff.error}</p>
        ) : (
          <DiffView text={diff.diff} truncated={diff.truncated} />
        ))}
    </li>
  );
}

/** A unified diff as numbered lines: added in green, removed in red, the hunks' headers as separators. */
function DiffView({ text, truncated }: { text: string; truncated: boolean }) {
  const t = useT();
  const rows: Array<{ kind: "add" | "del" | "ctx" | "hunk"; text: string; n?: number }> = [];
  let oldN = 0;
  let newN = 0;
  let body = false;
  for (const line of text.split("\n")) {
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)/.exec(line);
    if (hunk) {
      oldN = Number(hunk[1]);
      newN = Number(hunk[2]);
      body = true;
      rows.push({ kind: "hunk", text: line.replace(/^@@[^@]*@@\s?/, "") });
    } else if (!body) {
      if (line.startsWith("Binary files")) rows.push({ kind: "hunk", text: t("changes.binary") });
    } else if (line.startsWith("+")) rows.push({ kind: "add", text: line.slice(1), n: newN++ });
    else if (line.startsWith("-")) rows.push({ kind: "del", text: line.slice(1), n: oldN++ });
    else if (line.startsWith(" ")) {
      rows.push({ kind: "ctx", text: line.slice(1), n: newN++ });
      oldN++;
    }
  }
  if (!rows.length) return <p className="wchanges__error">{t("changes.empty")}</p>;
  return (
    <div className="diff">
      {rows.map((r, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: a diff's lines have no identity of their own
        <div key={i} className={`diff__line diff__line--${r.kind}`}>
          <span className="diff__n">{r.n ?? ""}</span>
          <span className="diff__sign">{r.kind === "add" ? "+" : r.kind === "del" ? "−" : ""}</span>
          <span className="diff__text">{r.text}</span>
        </div>
      ))}
      {truncated && <p className="wchanges__error">{t("changes.truncated")}</p>}
    </div>
  );
}
