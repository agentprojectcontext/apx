import "../styles/panel-parts.css";
import { Button, IconButton, Icons, Skeleton, Tooltip } from "@apx/ui";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { client } from "../data/client.ts";
import { relativeInside } from "../data/paths.ts";
import { useT } from "../i18n/index.ts";
import { go } from "../shell/nav.ts";
import type { ChangeRow } from "./change-records.ts";
import { DiffLines, DiffView } from "./DiffView.tsx";
import { type DiffRow, patchRows, wholeFileRows } from "./diff.ts";
import { useFileDiff } from "./useFileDiff.ts";

/** The file as it is now, when it is text the panel can read whole. */
async function currentText(thread: string, row: ChangeRow): Promise<string | undefined> {
  const where = row.scratch ? { thread, scratch: true } : { thread };
  const { root } = await client.call("files.tree", { ...where, dir: "" });
  // A temp file is named from the temp folder itself; another may be in a folder inside the chat's.
  const rel = relativeInside(root, `${row.cwd}/${row.file.path}`) ?? (row.scratch ? row.file.path : undefined);
  if (!rel) return undefined;
  const f = await client.call("files.read", { ...where, path: rel });
  return f.binary || f.truncated || f.text == null ? undefined : f.text;
}

/** A changed file in its own tab: the whole file with every change marked in place, opened at the first one. */
export function WholeDiff({ thread, row }: { thread: string; row: ChangeRow }) {
  const t = useT();
  const { file } = row;
  const deleted = file.status.includes("D");
  const { diff, loading, load } = useFileDiff(thread, row, true);
  // undefined while reading; null when the file cannot be read whole (gone, binary, too big, outside the folder).
  const [text, setText] = useState<string | null>();
  // biome-ignore lint/correctness/useExhaustiveDependencies: the row is read again only when it is another change.
  useEffect(() => {
    if (deleted) return setText(null);
    let live = true;
    currentText(thread, row).then(
      (s) => live && setText(s ?? null),
      () => live && setText(null),
    );
    return () => {
      live = false;
    };
  }, [thread, row.cwd, file.path, deleted]);
  const ref = useRef<HTMLDivElement>(null);
  const ready = diff && !("error" in diff) && text !== undefined;
  useEffect(() => {
    if (ready) ref.current?.querySelector(".diff__line--add, .diff__line--del")?.scrollIntoView({ block: "center" });
  }, [ready]);
  let body: ReactNode;
  if (loading || !diff || (!("error" in diff) && text === undefined)) body = <Skeleton className="wchanges__loading" />;
  else if ("error" in diff)
    body = (
      <div className="wchanges__error">
        <p>{diff.error}</p>
        <Button size="sm" variant="ghost" onClick={load}>
          {t("changes.refresh")}
        </Button>
      </div>
    );
  else if (diff.source === "current") body = <DiffView text={diff.diff} truncated={diff.truncated} current />;
  else {
    const whole = text && !diff.truncated ? wholeFileRows(diff.diff, text) : undefined;
    const { rows, binary } = patchRows(diff.diff);
    const shown: DiffRow[] = whole ?? (binary ? [{ kind: "hunk", text: t("changes.binary") }, ...rows] : rows);
    body = (
      <DiffLines
        ref={ref}
        rows={shown}
        truncated={diff.truncated}
        notice={!whole && text ? t("changes.wholeStale") : undefined}
        className="wdiff__lines"
      />
    );
  }
  return (
    <section className="wdiff" aria-label={file.path}>
      <header className="wdiff__head">
        <Tooltip content={file.path}>
          <span className="wdiff__path">{file.path}</span>
        </Tooltip>
        {file.added != null && <span className="wchanges__add">+{file.added}</span>}
        {file.removed != null && <span className="wchanges__del">−{file.removed}</span>}
        <span className="wchanges__spacer" />
        {!deleted && (
          <IconButton
            size="sm"
            label={t("changes.viewFile")}
            icon={<Icons.Eye size={14} />}
            onClick={() => go.file({ cwd: row.cwd, path: file.path, scratch: row.scratch })}
          />
        )}
      </header>
      <div className="wdiff__body">{body}</div>
    </section>
  );
}
