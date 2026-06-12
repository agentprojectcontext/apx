import { Bot, Copy, User, Info } from "lucide-react";
import { cn } from "../../lib/cn";
import { ToolCall } from "./ToolCall";
import { AskQuestionsCard } from "./AskQuestionsCard";
import { AskAnswersCard, parseAskAnswerText } from "./AskAnswersCard";
import { textOf, type ChatMsg } from "../../hooks/useChat";
import { t } from "../../i18n";

interface Props {
  msg: ChatMsg;
  /** True when this is the last message in the list. Used to detect if an
   *  ask_questions tool call is still waiting for the user vs already answered
   *  (a later user message would push this assistant turn off the bottom). */
  isLast?: boolean;
  /** True when this user message is the reply to a preceding `ask_questions`
   *  call. Renders as a full-width centered card instead of the user bubble. */
  isAskAnswer?: boolean;
  onCopy?: (text: string) => void;
}

export function MessageBubble({ msg, isLast, isAskAnswer, onCopy }: Props) {
  const mine = msg.role === "user";
  const copyText = textOf(msg);
  const hasTools = msg.parts.some((p) => p.kind === "tool");

  if (mine && isAskAnswer) {
    const text = textOf(msg);
    if (parseAskAnswerText(text)) {
      return <AskAnswersCard text={text} />;
    }
  }

  return (
    <div className={cn("group flex items-start gap-2", mine ? "justify-end" : "justify-start")}>
      {!mine && (
        <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground">
          <Bot size={14} />
        </span>
      )}
      <div className={cn("flex min-w-0 flex-col gap-1.5", mine ? "items-end" : "w-full max-w-[85%]")}>
        {/* Operational notes (engine fallbacks, retries, suppressed tools). */}
        {!mine && msg.notes && msg.notes.length > 0 && (
          <div className="flex flex-col gap-0.5">
            {msg.notes.map((n, i) => (
              <span key={i} className="flex items-center gap-1 text-[10px] text-amber-400/80">
                <Info size={10} /> {n}
              </span>
            ))}
          </div>
        )}

        {/* Ordered parts: interleaved assistant text + tool calls. */}
        {msg.parts.map((part, i) =>
          part.kind === "tool" ? (
            part.tool === "ask_questions" && !mine ? (
              <AskQuestionsCard
                key={`${part.id}-${i}`}
                part={part}
                pending={!!isLast}
              />
            ) : (
              <ToolCall key={`${part.id}-${i}`} part={part} />
            )
          ) : part.text ? (
            <div
              key={i}
              className={cn(
                "whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm leading-relaxed shadow-sm",
                mine
                  ? "rounded-br-sm border border-emerald-500/30 bg-emerald-500/10 text-foreground dark:bg-emerald-500/15"
                  : "w-full rounded-bl-sm border border-border bg-card text-foreground",
              )}
            >
              {part.text}
            </div>
          ) : null,
        )}

        {/* Pending placeholder before any part has arrived. */}
        {!mine && msg.pending && msg.parts.length === 0 && (
          <div className="rounded-2xl rounded-bl-sm border border-border bg-card px-3 py-2 text-sm text-muted-foreground">
            …
          </div>
        )}

        <div className="flex items-center gap-2 text-[10px] text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100">
          <span>{formatTs(msg.ts)}</span>
          {!mine && msg.model && <span className="font-mono">· {msg.model}</span>}
          {!mine && hasTools && (
            <span>· {msg.parts.filter((p) => p.kind === "tool").length} tools</span>
          )}
          {onCopy && copyText && (
            <button
              type="button"
              onClick={() => onCopy(copyText)}
              className="inline-flex items-center gap-1 hover:text-foreground"
              title={t("chat_ui.copy")}
              aria-label={t("chat_ui.copy")}
            >
              <Copy size={10} /> {t("chat_ui.copy")}
            </button>
          )}
        </div>
      </div>
      {mine && (
        <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground">
          <User size={14} />
        </span>
      )}
    </div>
  );
}

function formatTs(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch {
    return iso;
  }
}
