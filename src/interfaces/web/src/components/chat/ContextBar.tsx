import { useMemo, useState } from "react";
import { Bot, ChevronDown, FilePen, Gauge, Wrench } from "lucide-react";
import { cn } from "../../lib/cn";
import { FILE_TOOLS } from "./ToolCall";
import { t } from "../../i18n";
import type { ChatMsg, ToolPart } from "../../hooks/useChat";

interface ChangedFile {
  path: string;
  tool: string;
}

/** One (agent, model) pair that contributed to this conversation, with what it
 *  spent. A turn where the router fell back mid-conversation produces two rows
 *  for the same agent — that's the point: you see WHICH model cost what. */
interface ActorUsage {
  key: string;
  agent?: string;
  model?: string;
  inTok: number;
  outTok: number;
  turns: number;
}

// Pull the file path out of a write_file/edit_file invocation's args.
function filePathOf(args?: Record<string, unknown>): string | undefined {
  if (!args) return undefined;
  const p = args.path ?? args.file ?? args.filename;
  return typeof p === "string" ? p : undefined;
}

/**
 * Compact, opencode-style strip summarising the conversation: token usage,
 * tool count, an expandable list of files the agent wrote or edited, and the
 * per-actor breakdown (which agent answered on which model, and what each
 * spent). Renders nothing until the agent has actually done something.
 */
export function ContextBar({ msgs }: { msgs: ChatMsg[] }) {
  const [open, setOpen] = useState(false);

  const { inTok, outTok, toolCount, changed, actors } = useMemo(() => {
    let inTok = 0;
    let outTok = 0;
    let toolCount = 0;
    const seen = new Set<string>();
    const changed: ChangedFile[] = [];
    const byActor = new Map<string, ActorUsage>();
    for (const m of msgs) {
      if (m.role !== "assistant") continue;
      const mIn = m.usage?.input_tokens || 0;
      const mOut = m.usage?.output_tokens || 0;
      inTok += mIn;
      outTok += mOut;
      if (m.agent || m.model) {
        const key = `${m.agent || ""}::${m.model || ""}`;
        const prev = byActor.get(key);
        if (prev) {
          prev.inTok += mIn;
          prev.outTok += mOut;
          prev.turns += 1;
        } else {
          byActor.set(key, { key, agent: m.agent, model: m.model, inTok: mIn, outTok: mOut, turns: 1 });
        }
      }
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
    return { inTok, outTok, toolCount, changed, actors: [...byActor.values()] };
  }, [msgs]);

  const totalTok = inTok + outTok;
  const expandable = changed.length > 0 || actors.length > 1;
  if (totalTok === 0 && toolCount === 0 && actors.length === 0) return null;

  return (
    <div className="shrink-0 border-t border-border bg-card/40 text-[11px]">
      <button
        type="button"
        onClick={() => expandable && setOpen((v) => !v)}
        className={cn(
          // Wraps: on a phone the row is tokens + tools + changed files in
          // ~360px, and a nowrap flex row just pushed the last item off-screen.
          "flex w-full flex-wrap items-center gap-x-3 gap-y-0.5 px-4 py-1.5 text-muted-foreground",
          expandable && "hover:text-foreground",
        )}
      >
        <span className="flex items-center gap-1">
          <Gauge size={12} /> {fmt(totalTok)} tok
          <span className="text-muted-foreground">
            ({fmt(inTok)}↑ / {fmt(outTok)}↓)
          </span>
        </span>
        {toolCount > 0 && (
          <span className="flex items-center gap-1">
            <Wrench size={12} /> {toolCount} tools
          </span>
        )}
        {changed.length > 0 && (
          <span className="flex items-center gap-1 text-violet-700 dark:text-violet-400">
            <FilePen size={12} /> {changed.length} {t("chat_ui.ctx_files")}
          </span>
        )}
        {/* One actor → show it inline. Several → say how many and let the user
            expand for the split. */}
        {actors.length === 1 && (
          <span className="ml-auto truncate font-mono text-muted-foreground">
            {[actors[0].agent, actors[0].model].filter(Boolean).join(" · ")}
          </span>
        )}
        {actors.length > 1 && (
          <span className="ml-auto flex items-center gap-1 text-sky-700 dark:text-sky-400">
            <Bot size={12} /> {t("chat_ui.ctx_actors", { n: actors.length })}
          </span>
        )}
        {expandable && (
          <ChevronDown className={cn("size-3 shrink-0 transition-transform", open && "rotate-180")} />
        )}
      </button>

      {open && (
        <div className="max-h-52 space-y-2 overflow-y-auto border-t border-border/60 px-4 py-2">
          {actors.length > 1 && (
            <ul className="space-y-0.5">
              {actors.map((a) => (
                <li key={a.key} className="flex items-center gap-2 text-[11px]">
                  <Bot size={11} className="shrink-0 text-sky-700 dark:text-sky-400" />
                  <span className="shrink-0 font-medium text-emerald-700 dark:text-emerald-300">{a.agent || "—"}</span>
                  <span className="truncate font-mono text-muted-foreground">{a.model || "—"}</span>
                  <span className="ml-auto shrink-0 font-mono text-[10px] text-muted-foreground">
                    {fmt(a.inTok + a.outTok)} tok ({fmt(a.inTok)}↑ / {fmt(a.outTok)}↓) ·{" "}
                    {t("chat_ui.ctx_turns", { n: a.turns })}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {changed.length > 0 && (
            <ul className="space-y-0.5">
              {changed.map((f) => (
                <li key={f.path} className="flex items-center gap-2 font-mono text-[11px]">
                  <FilePen size={11} className="shrink-0 text-violet-700 dark:text-violet-400" />
                  <span className="truncate">{f.path}</span>
                  <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">
                    {f.tool === "write_file" ? "write" : "edit"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function fmt(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}
