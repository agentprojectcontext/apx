import { useT } from "../i18n/index.ts";

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
  const rows: Array<{ kind: "add" | "del" | "ctx" | "hunk"; text: string; n?: number }> = [];
  let oldN = 0;
  let newN = 0;
  let body = false;
  for (const [i, line] of text.split("\n").entries()) {
    if (current) {
      rows.push({ kind: "ctx", text: line, n: i + 1 });
      continue;
    }
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)/.exec(line);
    if (hunk) {
      oldN = Number(hunk[1]);
      newN = Number(hunk[2]);
      body = true;
      rows.push({ kind: "hunk", text: line });
    } else if (!body) {
      if (line.startsWith("Binary files")) rows.push({ kind: "hunk", text: t("changes.binary") });
    } else if (line.startsWith("+")) rows.push({ kind: "add", text: line.slice(1), n: newN++ });
    else if (line.startsWith("-")) rows.push({ kind: "del", text: line.slice(1), n: oldN++ });
    else if (line.startsWith(" ")) {
      rows.push({ kind: "ctx", text: line.slice(1), n: newN++ });
      oldN++;
    }
  }
  return (
    <div className="diff">
      {current && <p className="wchanges__notice">{t("changes.currentSource")}</p>}
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
}
