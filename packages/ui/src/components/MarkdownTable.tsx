import { Check, Copy, Maximize2 } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Button } from "./Button";
import { Dialog } from "./Dialog";
import { IconButton } from "./IconButton";

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
  copied: string;
  copyMarkdown: string;
  copyCsv: string;
  close: string;
}

export const MARKDOWN_LABELS: MarkdownLabels = {
  table: "Table",
  maximize: "Maximize table",
  copied: "Copied",
  copyMarkdown: "Copy as Markdown",
  copyCsv: "Copy as CSV",
  close: "Close",
};

const RULE: Record<TableAlign, string> = { left: "---", center: ":---:", right: "---:" };

/** The table back as Markdown, pipes in cells escaped, one row per line. */
export function tableMarkdown(t: TableSource): string {
  const row = (cells: string[]) => `| ${t.headers.map((_, j) => (cells[j] ?? "").replace(/\|/g, "\\|")).join(" | ")} |`;
  return [row(t.headers), `| ${t.align.map((a) => RULE[a]).join(" | ")} |`, ...t.rows.map(row)].join("\n");
}

/** One CSV field (RFC 4180): quoted when it holds a comma, quote or line break, inner quotes doubled. */
const csvField = (cell: string) => (/[",\r\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell);

/** Rows of cell text as CSV, one record per line. */
export function cellsCsv(rows: readonly (readonly string[])[]): string {
  return rows.map((row) => row.map(csvField).join(",")).join("\r\n");
}

/** What a rendered table reads (its words without the Markdown marks), as CSV. */
export function tableCsv(table: HTMLTableElement): string {
  return cellsCsv([...table.rows].map((tr) => [...tr.cells].map((c) => c.innerText.replace(/\s+/g, " ").trim())));
}

/**
 * A Markdown table in a frame of its own: wide tables scroll sideways inside it instead of squeezing their columns.
 * Under it, buttons copy it as Markdown or CSV; a corner button (on hover, always shown on touch screens) maximizes it.
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
  const [copied, setCopied] = useState<"md" | "csv">();
  useEffect(() => {
    if (!copied) return;
    const id = setTimeout(() => setCopied(undefined), 1500);
    return () => clearTimeout(id);
  }, [copied]);
  const copy = (kind: "md" | "csv", text: () => string) => () => {
    navigator.clipboard.writeText(text()).then(
      () => setCopied(kind),
      () => setCopied(undefined),
    );
  };
  const csv = () => {
    const table = scroller.current?.querySelector("table");
    return table ? tableCsv(table) : "";
  };
  const action = (kind: "md" | "csv", label: string, text: () => string) => (
    <Button
      variant="ghost"
      size="sm"
      leadingIcon={copied === kind ? <Check size={13} /> : <Copy size={13} />}
      onClick={copy(kind, text)}
    >
      {copied === kind ? labels.copied : label}
    </Button>
  );
  return (
    <div className="apx-md__tablebox">
      <div className="apx-md__table">
        <div className="apx-md__tablebar">
          <IconButton size="sm" label={labels.maximize} icon={<Maximize2 size={13} />} onClick={() => setOpen(true)} />
        </div>
        <div ref={scroller} className="apx-md__scroll">
          {children}
        </div>
      </div>
      <div className="apx-md__tableactions">
        {action("md", labels.copyMarkdown, () => tableMarkdown(source))}
        {action("csv", labels.copyCsv, csv)}
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
