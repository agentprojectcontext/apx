import { useState } from "react";
import { ChevronRight, FilePlus2, FilePen, FileX2, RefreshCw } from "lucide-react";
import { cn } from "../../lib/cn";
import { t } from "../../i18n";
import { Empty, Spinner } from "../ui";
import { DiffView } from "./DiffView";
import type { CodeChanges, CodeFileChange } from "../../lib/api/code";

interface Props {
  changes: CodeChanges | undefined;
  loading: boolean;
  onRefresh: () => void;
}

const STATUS_ICON = {
  added: FilePlus2,
  modified: FilePen,
  deleted: FileX2,
} as const;

const STATUS_COLOR = {
  added: "text-emerald-600 dark:text-emerald-400",
  modified: "text-amber-600 dark:text-amber-400",
  deleted: "text-rose-600 dark:text-rose-400",
} as const;

function FileRow({ file }: { file: CodeFileChange }) {
  const [open, setOpen] = useState(false);
  const Icon = STATUS_ICON[file.status];
  return (
    <li className="rounded-md border border-border">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs hover:bg-accent/40"
      >
        <ChevronRight className={cn("size-3 shrink-0 transition-transform", open && "rotate-90")} />
        <Icon className={cn("size-3.5 shrink-0", STATUS_COLOR[file.status])} />
        <span className="min-w-0 flex-1 truncate font-mono">{file.path}</span>
        <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
          {file.additions != null && <span className="text-emerald-600 dark:text-emerald-400">+{file.additions}</span>}
          {file.deletions != null && <span className="ml-1 text-rose-600 dark:text-rose-400">-{file.deletions}</span>}
        </span>
      </button>
      {open && (
        <div className="border-t border-border p-1.5">
          <DiffView patch={file.patch} />
        </div>
      )}
    </li>
  );
}

// Changes tab: file diffs of the working tree vs the session's git baseline.
export function CodeChangesTab({ changes, loading, onRefresh }: Props) {
  const files = changes?.files || [];
  return (
    <div className="flex h-full flex-col" data-testid="code-changes-tab">
      <div className="flex shrink-0 items-center justify-between px-3 py-2">
        <span className="text-[11px] text-muted-foreground">
          {files.length > 0 ? t("code_module.changes_files", { n: files.length }) : ""}
        </span>
        <button
          type="button"
          onClick={onRefresh}
          title="↻"
          className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          {loading ? <Spinner size={12} /> : <RefreshCw className="size-3" />}
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        {changes && !changes.git ? (
          <Empty>{t("code_module.changes_no_git")}</Empty>
        ) : files.length === 0 ? (
          <Empty>{t("code_module.changes_none")}</Empty>
        ) : (
          <ul className="space-y-1.5">
            {files.map((f) => (
              <FileRow key={f.path} file={f} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
