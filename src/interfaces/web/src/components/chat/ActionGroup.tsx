import { useState } from "react";
import { ChevronRight, Loader2, Wrench } from "lucide-react";
import { cn } from "../../lib/cn";
import { ToolCall } from "./ToolCall";
import { AskQuestionsCard } from "./AskQuestionsCard";
import { ReasoningBlock } from "./ReasoningBlock";
import type { ChatPart } from "../../hooks/useChat";
import { t } from "../../i18n";

// One run of tool calls, as a block: the tools the agent ran back to back,
// behind a row that names how many and whether any failed.
//
// A turn here can take 24 steps, so the transcript used to read as bubble,
// card, bubble, card … for a whole screen — the answer buried at the bottom of
// its own progress log. The steps are worth keeping (a failed call is often the
// whole story), just not worth a screenful: they collapse into one row, one
// click from the detail.
//
// A turn may have SEVERAL of these, in the order the work happened, with what
// the agent said in between standing outside them (see segmentTurnParts). They
// are numbered against the turn's own count, not each block's, so the reader
// still reads one turn rather than a series of small ones.
//
// Open while the turn runs — you want to watch it work — and collapsed once it
// finishes, unless the reader says otherwise (their click wins from then on).

interface Props {
  /** One run of tool calls, with the reasoning around them. */
  parts: ChatPart[];
  /** The turn is still streaming. */
  running?: boolean;
  /** Where this run sits in the turn's own count (1-based, inclusive). Given
   *  only when the turn has more than one block — a lone block just says how
   *  many, and "actions 1–4 of 4" would be noise. */
  range?: { from: number; to: number; total: number };
}

export function ActionGroup({ parts, running, range }: Props) {
  const [manual, setManual] = useState<boolean | null>(null);

  const tools = parts.filter((p) => p.kind === "tool");
  const failed = tools.filter((p) => p.kind === "tool" && p.status === "error").length;
  // An ask_questions card is a control the user has to reach — never hide it.
  const hasAsk = tools.some((p) => p.kind === "tool" && p.tool === "ask_questions");
  const open = manual ?? (!!running || hasAsk);

  if (tools.length === 0) return null;

  return (
    <div className="w-full overflow-hidden rounded-lg border border-border bg-muted/20">
      <button
        type="button"
        onClick={() => setManual(!open)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[12px]"
      >
        <ChevronRight
          className={cn("size-3 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")}
        />
        {running ? (
          <Loader2 className="size-3.5 shrink-0 animate-spin text-sky-700 dark:text-sky-400" />
        ) : (
          <Wrench className="size-3.5 shrink-0 text-muted-foreground" />
        )}
        <span className="font-medium">
          {range
            // "Actions 7–7 of 7" for a block of one is a sentence tripping over
            // itself; it is action 7.
            ? range.from === range.to
              ? t("chat_ui.actions_at", { n: range.from, total: range.total })
              : t("chat_ui.actions_range", { from: range.from, to: range.to, total: range.total })
            : tools.length === 1
              ? t("chat_ui.actions_count_one")
              : t("chat_ui.actions_count", { n: tools.length })}
        </span>
        {failed > 0 && (
          <span className="text-rose-700 dark:text-rose-400">
            · {t("shared_ui.tools_failed", { n: failed })}
          </span>
        )}
      </button>

      {open && (
        <div className="flex flex-col gap-1.5 border-t border-border/60 px-2.5 py-2">
          {parts.map((part, i) =>
            part.kind === "reasoning" ? (
              <ReasoningBlock key={i} text={part.text} streaming={part.streaming} />
            ) : part.kind === "tool" ? (
              part.tool === "ask_questions" ? (
                <AskQuestionsCard key={`${part.id}-${i}`} part={part} pending={false} />
              ) : (
                <ToolCall key={`${part.id}-${i}`} part={part} />
              )
            ) : null,
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Cut a turn into the blocks it actually happened in.
 *
 * A turn is an ordered list: the agent says a line, runs three tools, says
 * what it found, runs three more, answers. This used to be flattened to
 * "everything up to the LAST tool call" + "whatever came after" — one opaque
 * work block with every sentence the agent wrote along the way buried inside
 * it, and only the closing line left standing. What it did in between was
 * readable only by expanding a log; turning the log off left the middle of the
 * turn missing entirely.
 *
 * So: consecutive tool calls collapse into a block, and anything the agent SAID
 * stays out of the blocks, in the order it said it. Same parts, same turn, same
 * count — the shape it happened in.
 *
 * `ask_questions` is never grouped: it is a control the reader has to reach.
 * Reasoning belongs to the step it was thinking about, so it rides in the
 * neighbouring block, and stands alone only when there is no block to join.
 */
export type TurnSegment =
  /** A run of tool calls (with the reasoning around them). `from`/`to` are the
   *  1-based positions of its first and last tool WITHIN THE TURN, so several
   *  blocks read as one counter rather than restarting at 1. */
  | { kind: "work"; parts: ChatPart[]; from: number; to: number }
  /** Something the agent said, or a card that must stay in the open. */
  | { kind: "part"; part: ChatPart };

const isWorkTool = (p: ChatPart) => p.kind === "tool" && p.tool !== "ask_questions";

export function segmentTurnParts(parts: ChatPart[]): TurnSegment[] {
  const out: TurnSegment[] = [];
  let open: Extract<TurnSegment, { kind: "work" }> | null = null;
  let seen = 0; // tools so far in this turn — the shared counter

  for (const part of parts) {
    if (isWorkTool(part)) {
      seen += 1;
      if (!open) {
        open = { kind: "work", parts: [], from: seen, to: seen };
        out.push(open);
      }
      open.parts.push(part);
      open.to = seen;
      continue;
    }
    // Thinking joins the block it was thinking about rather than opening one:
    // a block that is nothing but reasoning would render as "0 actions".
    if (part.kind === "reasoning" && open) {
      open.parts.push(part);
      continue;
    }
    open = null;
    out.push({ kind: "part", part });
  }
  return out;
}

/** Tool calls in the turn — the total the blocks are numbered against. */
export function countTurnTools(parts: ChatPart[]): number {
  return parts.filter(isWorkTool).length;
}
