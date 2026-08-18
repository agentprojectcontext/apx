import { useState } from "react";
import { ChevronRight, Loader2, Wrench } from "lucide-react";
import { cn } from "../../lib/cn";
import { ToolCall } from "./ToolCall";
import { AskQuestionsCard } from "./AskQuestionsCard";
import type { ChatPart } from "../../hooks/useChat";
import { t } from "../../i18n";

// The work half of a turn, as ONE block: every tool the agent ran and the short
// line it wrote before each one.
//
// A turn here can take 24 steps, and the agent narrates before each of them, so
// the transcript used to read as bubble, card, bubble, card … for a whole
// screen — the answer buried at the bottom of its own progress log. The steps
// are worth keeping (a failed call is often the whole story), just not worth a
// screenful: they collapse into one row that names the count and any failures,
// one click from the detail.
//
// Open while the turn runs — you want to watch it work — and collapsed once it
// finishes, unless the reader says otherwise (their click wins from then on).

interface Props {
  /** The run of parts up to and including the last tool call. */
  parts: ChatPart[];
  /** The turn is still streaming. */
  running?: boolean;
}

export function ActionGroup({ parts, running }: Props) {
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
          {tools.length === 1
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
            part.kind === "tool" ? (
              part.tool === "ask_questions" ? (
                <AskQuestionsCard key={`${part.id}-${i}`} part={part} pending={false} />
              ) : (
                <ToolCall key={`${part.id}-${i}`} part={part} />
              )
            ) : part.text ? (
              // The line the agent wrote before the next call: why it did it.
              // Muted, not a bubble — it is a caption for the step below it.
              <p key={i} className="px-0.5 text-[12px] leading-relaxed text-muted-foreground">
                {part.text}
              </p>
            ) : null,
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Split a turn into the work that led to the answer and everything after it.
 * `work` runs up to the LAST tool call (ask_questions excluded — it ends a turn
 * and its card must stay in the open); `rest` is what the agent said once the
 * work was done, which is the part the reader actually came for.
 */
export function splitTurnParts(parts: ChatPart[]): { work: ChatPart[]; rest: ChatPart[] } {
  let lastWork = -1;
  parts.forEach((p, i) => {
    if (p.kind === "tool" && p.tool !== "ask_questions") lastWork = i;
  });
  if (lastWork < 0) return { work: [], rest: parts };
  return { work: parts.slice(0, lastWork + 1), rest: parts.slice(lastWork + 1) };
}
