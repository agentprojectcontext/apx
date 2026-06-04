import { useMemo, useState } from "react";
import { ChevronDown, FilePen, Gauge, Wrench } from "lucide-react";
import { cn } from "../../lib/cn";
import { FILE_TOOLS } from "./ToolCall";
import type { ChatMsg, ToolPart } from "../../hooks/useChat";

interface ChangedFile {
  path: string;
  tool: string;
}

// Pull the file path out of a write_file/edit_file invocation's args.
function filePathOf(args?: Record<string, unknown>): string | undefined {
  if (!args) return undefined;
  const p = args.path ?? args.file ?? args.filename;
  return typeof p === "string" ? p : undefined;
}

/**
 * Compact, opencode-style strip summarising the conversation: token usage,
 * tool count, and an expandable list of files the agent wrote or edited.
 * Renders nothing until the agent has actually done something.
 */
export function ContextBar({ msgs }: { msgs: ChatMsg[] }) {
  const [open, setOpen] = useState(false);

  const { inTok, outTok, toolCount, changed, model } = useMemo(() => {
    let inTok = 0;
    let outTok = 0;
    let toolCount = 0;
    let model: string | undefined;
    const seen = new Set<string>();
    const changed: ChangedFile[] = [];
    for (const m of msgs) {
      if (m.role !== "assistant") continue;
      if (m.usage) {
        inTok += m.usage.input_tokens || 0;
        outTok += m.usage.output_tokens || 0;
      }
      if (m.model) model = m.model;
      for (const part of m.parts) {
        if (part.kind !== "tool") continue;
        toolCount += 1;
        if (FILE_TOOLS.has(part.tool) && (part as ToolPart).status !== "error") {
          const path = filePathOf(part.args);
          if (path && !seen.has(path)) {
            seen.add(path);
            changed.push({ path, tool: part.tool });
          }
        }
      }
    }
    return { inTok, outTok, toolCount, changed, model };
  }, [msgs]);

  const totalTok = inTok + outTok;
  if (totalTok === 0 && toolCount === 0) return null;

  return (
    <div className="shrink-0 border-t border-border bg-card/40 text-[11px]">
      <button
        type="button"
        onClick={() => changed.length > 0 && setOpen((v) => !v)}
        className={cn(
          "flex w-full items-center gap-3 px-4 py-1.5 text-muted-foreground",
          changed.length > 0 && "hover:text-foreground",
        )}
      >
        <span className="flex items-center gap-1">
          <Gauge size={12} /> {fmt(totalTok)} tok
          <span className="text-muted-foreground/60">
            ({fmt(inTok)}↑ / {fmt(outTok)}↓)
          </span>
        </span>
        {toolCount > 0 && (
          <span className="flex items-center gap-1">
            <Wrench size={12} /> {toolCount} tools
          </span>
        )}
        {changed.length > 0 && (
          <span className="flex items-center gap-1 text-violet-400">
            <FilePen size={12} /> {changed.length} archivos
          </span>
        )}
        {model && <span className="ml-auto font-mono text-muted-foreground/70">{model}</span>}
        {changed.length > 0 && (
          <ChevronDown className={cn("size-3 shrink-0 transition-transform", open && "rotate-180")} />
        )}
      </button>

      {open && changed.length > 0 && (
        <ul className="max-h-40 space-y-0.5 overflow-y-auto border-t border-border/60 px-4 py-2">
          {changed.map((f) => (
            <li key={f.path} className="flex items-center gap-2 font-mono text-[11px]">
              <FilePen size={11} className="shrink-0 text-violet-400" />
              <span className="truncate">{f.path}</span>
              <span className="ml-auto shrink-0 text-[10px] text-muted-foreground/60">
                {f.tool === "write_file" ? "write" : "edit"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function fmt(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}
