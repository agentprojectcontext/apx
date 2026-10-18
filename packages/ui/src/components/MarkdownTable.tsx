import { Check, Copy, Maximize2 } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Dialog } from "./Dialog";
import { IconButton } from "./IconButton";
import { Menu } from "./Menu";

export type TableAlign = "left" | "center" | "right";

/** A pipe table as written: header cells, body rows and each column's alignment. */
export interface TableSource {
  headers: string[];
  rows: string[][];
  align: TableAlign[];
}

/** Names of the table's controls; English by default, the app passes its translations. */
export interface MarkdownLabels {
  table: string;
  maximize: string;
  copy: string;
  copied: string;
  copyMarkdown: string;
  copyTsv: string;
  close: string;
}

export const MARKDOWN_LABELS: MarkdownLabels = {
  table: "Table",
  maximize: "Maximize table",
  copy: "Copy table",
  copied: "Copied",
  copyMarkdown: "Copy as Markdown",
  copyTsv: "Copy as TSV",
  close: "Close",
};

const RULE: Record<TableAlign, string> = { left: "---", center: ":---:", right: "---:" };

/** The table back as Markdown, pipes in cells escaped, one row per line. */
export function tableMarkdown(t: TableSource): string {
  const row = (cells: string[]) => `| ${t.headers.map((_, j) => (cells[j] ?? "").replace(/\|/g, "\\|")).join(" | ")} |`;
  return [row(t.headers), `| ${t.align.map((a) => RULE[a]).join(" | ")} |`, ...t.rows.map(row)].join("\n");
}

/** What a rendered table reads, as tab-separated lines (pastes into a spreadsheet). */
export function tableTsv(table: HTMLTableElement): string {
  return [...table.rows]
    .map((tr) => [...tr.cells].map((c) => c.innerText.replace(/\s+/g, " ").trim()).join("\t"))
    .join("\n");
}

/**
 * A Markdown table in a frame of its own: wide tables scroll sideways inside it instead of squeezing their columns,
 * and a toolbar (on hover, always shown on touch screens) copies it or opens it maximized.
 */
export function MarkdownTable({
  source,
  labels,
  className,
  children,
}: {
  source: TableSource;
  labels: MarkdownLabels;
  /** The markdown root's classes, so the maximized copy keeps its look outside it. */
  className: string;
  /** The rendered `<table>`. */
  children: ReactNode;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const id = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(id);
  }, [copied]);
  const copy = (text: () => string) => () => {
    navigator.clipboard.writeText(text()).then(
      () => setCopied(true),
      () => setCopied(false),
    );
  };
  const tsv = () => {
    const table = scroller.current?.querySelector("table");
    return table ? tableTsv(table) : "";
  };
  return (
    <div className="apx-md__table">
      <div className="apx-md__tablebar">
        <Menu
          align="end"
          trigger={
            <IconButton
              size="sm"
              label={copied ? labels.copied : labels.copy}
              icon={copied ? <Check size={13} /> : <Copy size={13} />}
            />
          }
          items={[
            { label: labels.copyMarkdown, onSelect: copy(() => tableMarkdown(source)) },
            { label: labels.copyTsv, onSelect: copy(tsv) },
          ]}
        />
        <IconButton size="sm" label={labels.maximize} icon={<Maximize2 size={13} />} onClick={() => setOpen(true)} />
      </div>
      <div ref={scroller} className="apx-md__scroll">
        {children}
      </div>
      {open && (
        <Dialog
          open
          onOpenChange={setOpen}
          size="xl"
          title={labels.table}
          closeLabel={labels.close}
          className="apx-md__dialog"
        >
          <div className={className}>
            <div className="apx-md__scroll apx-md__scroll--max">{children}</div>
          </div>
        </Dialog>
      )}
    </div>
  );
}
