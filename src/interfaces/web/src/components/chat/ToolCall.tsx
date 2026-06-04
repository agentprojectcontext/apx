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

// Map registered tool names (core/agent tools) to an icon + friendly label.
const TOOL_META: Record<string, { icon: typeof Wrench; label: string }> = {
  read_file: { icon: FileText, label: "Leer archivo" },
  write_file: { icon: FilePlus, label: "Escribir archivo" },
  edit_file: { icon: FilePen, label: "Editar archivo" },
  list_files: { icon: FolderTree, label: "Listar archivos" },
  search_files: { icon: Search, label: "Buscar en archivos" },
  search_messages: { icon: Search, label: "Buscar mensajes" },
  tail_messages: { icon: Search, label: "Últimos mensajes" },
  run_shell: { icon: Terminal, label: "Ejecutar shell" },
  send_telegram: { icon: Send, label: "Enviar Telegram" },
  call_agent: { icon: Bot, label: "Llamar agente" },
  call_mcp: { icon: Plug, label: "Llamar MCP" },
  call_runtime: { icon: Bot, label: "Llamar runtime" },
  create_task: { icon: ListTodo, label: "Crear tarea" },
};

const FILE_TOOLS = new Set(["write_file", "edit_file"]);

function metaFor(tool: string) {
  return TOOL_META[tool] || { icon: Wrench, label: tool };
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

function StatusIcon({ status }: { status: ToolPart["status"] }) {
  if (status === "running") return <Loader2 className="size-3 shrink-0 animate-spin text-sky-400" />;
  if (status === "error") return <X className="size-3 shrink-0 text-rose-400" />;
  if (status === "deduped") return <CornerDownRight className="size-3 shrink-0 text-amber-400" />;
  return <Check className="size-3 shrink-0 text-emerald-400" />;
}

export function ToolCall({ part }: { part: ToolPart }) {
  const [open, setOpen] = useState(false);
  const { icon: Icon, label } = metaFor(part.tool);
  const summary = argSummary(part.tool, part.args);
  const isFile = FILE_TOOLS.has(part.tool);
  const hasBody = !!part.args || part.result !== undefined;

  return (
    <div
      className={cn(
        "rounded-lg border bg-muted/30 text-[12px]",
        part.status === "error" ? "border-rose-500/30" : "border-border",
      )}
    >
      <button
        type="button"
        onClick={() => hasBody && setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left"
      >
        {hasBody ? (
          <ChevronRight className={cn("size-3 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")} />
        ) : (
          <span className="size-3 shrink-0" />
        )}
        <Icon className={cn("size-3.5 shrink-0", isFile ? "text-violet-400" : "text-muted-foreground")} />
        <span className="shrink-0 font-medium">{label}</span>
        {summary && <span className="truncate font-mono text-muted-foreground">{summary}</span>}
        <span className="ml-auto flex items-center gap-1">
          {part.status === "deduped" && <span className="text-[10px] text-amber-400">dedup</span>}
          <StatusIcon status={part.status} />
        </span>
      </button>

      {open && hasBody && (
        <div className="space-y-2 border-t border-border/60 px-2.5 py-2">
          {part.args && Object.keys(part.args).length > 0 && (
            <div>
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70">args</div>
              <pre className="max-h-48 overflow-auto rounded-md bg-background/60 p-2 font-mono text-[11px] leading-relaxed text-foreground">
                {pretty(part.args)}
              </pre>
            </div>
          )}
          {part.result !== undefined && (
            <div>
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70">result</div>
              <pre
                className={cn(
                  "max-h-64 overflow-auto rounded-md bg-background/60 p-2 font-mono text-[11px] leading-relaxed",
                  part.status === "error" ? "text-rose-300" : "text-foreground",
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
