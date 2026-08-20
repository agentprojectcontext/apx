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
 * tool count, the files the agent wrote or edited, and the per-actor breakdown
 * (which agent answered on which model, and what each spent).
 *
 * Collapsed, it is icons and numbers and nothing else. It used to spell out
 * "1500.8k tok (1483.1k↑ / 17.7k↓)" and the model's full name, which is three
 * quarters of a phone's width spent on a line nobody reads mid-conversation —
 * and it wrapped to two rows to do it. Every word of that still exists, one
 * tap away. Renders nothing until the agent has actually done something.
 */
export function ContextBar({ msgs, docked = false, onOpenChange }: {
  msgs: ChatMsg[];
  /** Sit inside the composer card as its top edge, instead of as a standalone
   *  strip above it. The detail then opens upward, out of the same seam. */
  docked?: boolean;
  /** Told when the detail opens or closes. The host freezes the space the
   *  thread reserves while it is open, so the conversation is covered rather
   *  than shoved up and back down around a panel open for two seconds. */
  onOpenChange?: (open: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  // Told OUTSIDE the updater. A state updater runs during render, and calling
  // the host's setState from in there is React updating one component while
  // rendering another — which it refuses, mid-render, taking whatever else was
  // being committed down with it.
  const toggle = () => {
    const next = !open;
    setOpen(next);
    onOpenChange?.(next);
  };

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
  if (totalTok === 0 && toolCount === 0 && actors.length === 0) return null;

  const detail = (
    <div
      className={cn(
        "space-y-2 overflow-y-auto px-4 py-2 text-[11px]",
        docked ? "max-h-[40vh]" : "max-h-52 border-t border-border/60",
      )}
    >
      {/* The numbers the collapsed row reduced to glyphs, spelled out. */}
      <ul className="space-y-0.5 text-muted-foreground">
        <li className="flex items-center gap-2">
          <Gauge size={11} className="shrink-0" />
          <span>{t("chat_ui.ctx_tokens")}</span>
          <span className="ml-auto font-mono">
            {fmt(totalTok)} ({fmt(inTok)}↑ / {fmt(outTok)}↓)
          </span>
        </li>
        {toolCount > 0 && (
          <li className="flex items-center gap-2">
            <Wrench size={11} className="shrink-0" />
            <span>{t("chat_ui.ctx_tools")}</span>
            <span className="ml-auto font-mono">{toolCount}</span>
          </li>
        )}
      </ul>
      {actors.length > 0 && (
        <ul className="space-y-0.5">
          {actors.map((a) => (
            // One line each where there is room, and only where there is not
            // does the spend drop under the name. Forcing the two lines always
            // made a wide panel read as a stack of paragraphs; forcing one line
            // always truncated "zen:deepseek-v4-flash-free" to "ze…" on a
            // phone, which is the one field here you cannot guess from the
            // rest. Wrapping decides it per width.
            <li key={a.key} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[11px]">
              <Bot size={11} className="shrink-0 self-center text-sky-700 dark:text-sky-400" />
              <span className="shrink-0 font-medium text-emerald-700 dark:text-emerald-300">{a.agent || "—"}</span>
              <span className="min-w-0 font-mono [overflow-wrap:anywhere] text-muted-foreground">{a.model || "—"}</span>
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
  );

  return (
    <div
      className={cn(
        "shrink-0 text-[11px]",
        // Docked: full-bleed inside the composer card's padding, so the strip
        // IS the card's top edge — no gap, no second border, no floating line
        // above a floating field.
        docked
          ? "-mx-2 -mt-2 overflow-hidden rounded-t-[calc(1rem-1px)] border-b border-border/70 bg-muted/40"
          : "border-t border-border bg-card/40",
      )}
    >
      {/* Docked, the detail grows the card UPWARD from inside it. Floating it
          over the card as its own sheet lined the edges up perfectly and still
          read as a second box glued on top — a panel that belongs to the field
          has to live inside the field's border. What it must NOT do is move the
          conversation: the host freezes the space the thread reserves while
          this is open (see `onOpenChange`), so the card covers the text instead
          of shoving it. */}
      {docked && open && detail}
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-label={t("chat_ui.ctx_expand")}
        className={cn(
          "flex w-full items-center gap-3 px-4 py-1.5 text-muted-foreground hover:text-foreground",
          docked && open && "border-t border-border/70",
        )}
      >
        <span className="flex items-center gap-1 tabular-nums">
          <Gauge size={12} /> {fmt(totalTok)}
        </span>
        {toolCount > 0 && (
          <span className="flex items-center gap-1 tabular-nums">
            <Wrench size={12} /> {toolCount}
          </span>
        )}
        {changed.length > 0 && (
          <span className="flex items-center gap-1 tabular-nums text-violet-700 dark:text-violet-400">
            <FilePen size={12} /> {changed.length}
          </span>
        )}
        {actors.length > 0 && (
          <span className="flex items-center gap-1 tabular-nums text-sky-700 dark:text-sky-400">
            <Bot size={12} /> {actors.length}
          </span>
        )}
        {/* The arrow points at where the panel will appear — which is UP when
            docked, since the dock grows out of the bottom of the screen. */}
        <ChevronDown
          className={cn(
            "ml-auto size-3 shrink-0 transition-transform",
            docked !== open && "rotate-180",
          )}
        />
      </button>
      {!docked && open && detail}
    </div>
  );
}

function fmt(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}
