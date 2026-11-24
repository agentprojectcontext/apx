import "../styles/panel-parts.css";
import { forwardRef } from "react";
import { useT } from "../i18n/index.ts";
import { type DiffRow, patchRows } from "./diff.ts";

/** Unified patch lines, or a clearly labeled current-source fallback for older records. */
export function DiffView({
  text,
  truncated,
  current = false,
}: {
  text: string;
  truncated: boolean;
  current?: boolean;
}) {
  const t = useT();
  const { rows, binary } = current
    ? { rows: text.split("\n").map((line, i): DiffRow => ({ kind: "ctx", text: line, n: i + 1 })), binary: false }
    : patchRows(text);
  return (
    <DiffLines
      rows={binary ? [{ kind: "hunk", text: t("changes.binary") }, ...rows] : rows}
      truncated={truncated}
      notice={current ? t("changes.currentSource") : undefined}
    />
  );
}

/** Diff rows as lines: number, sign and text. */
export const DiffLines = forwardRef<
  HTMLDivElement,
  { rows: DiffRow[]; truncated: boolean; notice?: string | undefined; className?: string }
>(function DiffLines({ rows, truncated, notice, className }, ref) {
  const t = useT();
  return (
    <div ref={ref} className={className ? `diff ${className}` : "diff"}>
      {notice && <p className="wchanges__notice">{notice}</p>}
      {!rows.length && <p className="wchanges__error">{t("changes.empty")}</p>}
      {rows.map((r, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: patch lines are positional
        <div key={i} className={`diff__line diff__line--${r.kind}`}>
          <span className="diff__n">{r.n ?? ""}</span>
          <span className="diff__sign">{r.kind === "add" ? "+" : r.kind === "del" ? "−" : ""}</span>
          <span className="diff__text">{r.text}</span>
        </div>
      ))}
      {truncated && <p className="wchanges__error">{t("changes.truncated")}</p>}
    </div>
  );
});
