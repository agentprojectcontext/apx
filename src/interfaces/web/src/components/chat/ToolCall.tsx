import { useState } from "react";
import {
  ChevronRight,
  FileText,
  FilePen,
  FilePlus,
  Search,
  FolderTree,
  Terminal,
  Send,
  Bot,
  Plug,
  ListTodo,
  Wrench,
  Loader2,
  Check,
  X,
  CornerDownRight,
} from "lucide-react";
import { cn } from "../../lib/cn";
import type { ToolPart } from "../../hooks/useChat";
import { t } from "../../i18n";

// Map registered tool names (core/agent tools) to an icon + friendly label.
// Built per-call so t() runs against the active locale at render time.
function toolMeta(): Record<string, { icon: typeof Wrench; label: string }> {
  return {
    read_file: { icon: FileText, label: t("shared_ui.tool_read_file") },
    write_file: { icon: FilePlus, label: t("shared_ui.tool_write_file") },
    edit_file: { icon: FilePen, label: t("shared_ui.tool_edit_file") },
    list_files: { icon: FolderTree, label: t("shared_ui.tool_list_files") },
    search_files: { icon: Search, label: t("shared_ui.tool_search_files") },
    search_messages: { icon: Search, label: t("shared_ui.tool_search_messages") },
    tail_messages: { icon: Search, label: t("shared_ui.tool_tail_messages") },
    run_shell: { icon: Terminal, label: t("shared_ui.tool_run_shell") },
    send_telegram: { icon: Send, label: t("shared_ui.tool_send_telegram") },
    call_agent: { icon: Bot, label: t("shared_ui.tool_call_agent") },
    call_mcp: { icon: Plug, label: t("shared_ui.tool_call_mcp") },
    call_runtime: { icon: Bot, label: t("shared_ui.tool_call_runtime") },
    create_task: { icon: ListTodo, label: t("shared_ui.tool_create_task") },
    list_tasks: { icon: ListTodo, label: t("shared_ui.tool_list_tasks") },
    get_task: { icon: ListTodo, label: t("shared_ui.tool_get_task") },
    update_task: { icon: ListTodo, label: t("shared_ui.tool_update_task") },
    complete_task: { icon: ListTodo, label: t("shared_ui.tool_complete_task") },
    comment_task: { icon: ListTodo, label: t("shared_ui.tool_comment_task") },
  };
}

const FILE_TOOLS = new Set(["write_file", "edit_file"]);

function metaFor(tool: string) {
  return toolMeta()[tool] || { icon: Wrench, label: tool };
}

// Best-effort one-line argument summary shown next to the tool title.
function argSummary(tool: string, args?: Record<string, unknown>): string {
  if (!args) return "";
  const pick = (k: string) => (typeof args[k] === "string" ? (args[k] as string) : undefined);
  const first =
    pick("path") ||
    pick("file") ||
    pick("pattern") ||
    pick("query") ||
    pick("command") ||
    pick("slug") ||
    pick("name") ||
    // Task tools: the title on a create, the id on everything that acts on one.
    pick("title") ||
    pick("task") ||
    pick("agent");
  return first ? String(first) : "";
}

function pretty(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

/** What the status means, in words. A 12px glyph is the whole report on how a
 *  step went, and on a phone — no hover, no tooltip — the colour is all a
 *  reader gets. The label rides along as the icon's accessible name, and shows
 *  as text for the two states that are not "it worked". */
function statusLabel(status: ToolPart["status"]): string {
  if (status === "running") return t("shared_ui.tool_running");
  if (status === "error") return t("shared_ui.tool_error");
  if (status === "deduped") return t("shared_ui.dedup");
  return t("shared_ui.tool_done");
}

function StatusIcon({ status }: { status: ToolPart["status"] }) {
  const label = statusLabel(status);
  const common = "size-3 shrink-0";
  if (status === "running") return <Loader2 role="img" aria-label={label} className={cn(common, "animate-spin text-sky-700 dark:text-sky-400")} />;
  if (status === "error") return <X role="img" aria-label={label} className={cn(common, "text-rose-700 dark:text-rose-400")} />;
  if (status === "deduped") return <CornerDownRight role="img" aria-label={label} className={cn(common, "text-amber-700 dark:text-amber-400")} />;
  return <Check role="img" aria-label={label} className={cn(common, "text-emerald-700 dark:text-emerald-400")} />;
}

export function ToolCall({ part }: { part: ToolPart }) {
  const [open, setOpen] = useState(false);
  const { icon: Icon, label } = metaFor(part.tool);
  const summary = argSummary(part.tool, part.args);
  const isFile = FILE_TOOLS.has(part.tool);
  const hasBody = !!part.args || part.result !== undefined;

  return (
    <div
      data-testid="tool-call"
      data-tool={part.tool}
      data-status={part.status}
      className={cn(
        "rounded-lg border bg-muted/30 text-[12px]",
        part.status === "error" ? "border-rose-500/30" : "border-border",
      )}
    >
      <button
        type="button"
        onClick={() => hasBody && setOpen((v) => !v)}
        aria-expanded={hasBody ? open : undefined}
        // min-w-0 on the row and on the summary, shrink-0 on everything that
        // must survive: inside a 390px bubble this row is ~300px wide, and a
        // flex child without min-w-0 is laid out around its whole content — so
        // one long `path` argument pushed the status mark off the right edge
        // instead of truncating, and the step's outcome simply vanished.
        className="flex w-full min-w-0 items-center gap-2 px-2.5 py-1.5 text-left"
      >
        {hasBody ? (
          <ChevronRight className={cn("size-3 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")} />
        ) : (
          <span className="size-3 shrink-0" />
        )}
        <Icon className={cn("size-3.5 shrink-0", isFile ? "text-violet-700 dark:text-violet-400" : "text-muted-foreground")} />
        <span className="shrink-0 font-medium">{label}</span>
        {summary && <span className="min-w-0 flex-1 truncate font-mono text-muted-foreground">{summary}</span>}
        <span className="ml-auto flex shrink-0 items-center gap-1">
          {/* The two outcomes that are not "it worked" say so in words. Colour
              alone is not a report — and it is the only one a phone gets. */}
          {(part.status === "deduped" || part.status === "error") && (
            <span
              className={cn(
                "text-[10px]",
                part.status === "error" ? "text-rose-700 dark:text-rose-400" : "text-amber-700 dark:text-amber-400",
              )}
            >
              {statusLabel(part.status)}
            </span>
          )}
          <StatusIcon status={part.status} />
        </span>
      </button>

      {open && hasBody && (
        <div className="space-y-2 border-t border-border/60 px-2.5 py-2">
          {part.args && Object.keys(part.args).length > 0 && (
            <div>
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{t("shared_ui.args")}</div>
              <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-md bg-background/60 p-2 font-mono text-[11px] leading-relaxed text-foreground">
                {pretty(part.args)}
              </pre>
            </div>
          )}
          {part.result !== undefined && (
            <div>
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{t("shared_ui.result")}</div>
              <pre
                className={cn(
                  "max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-md bg-background/60 p-2 font-mono text-[11px] leading-relaxed",
                  part.status === "error" ? "text-rose-700 dark:text-rose-300" : "text-foreground",
                )}
              >
                {pretty(part.result)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export { FILE_TOOLS };
