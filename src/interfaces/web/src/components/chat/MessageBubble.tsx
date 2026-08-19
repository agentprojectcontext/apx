import { Bot, Copy, Info } from "lucide-react";
import { cn } from "../../lib/cn";
import { AgentAvatar, type AgentFace } from "../agents/AgentAvatar";
import { ToolCall } from "./ToolCall";
import { ActionGroup, splitTurnParts } from "./ActionGroup";
import { SkillTrace } from "./SkillTrace";
import { ReasoningBlock } from "./ReasoningBlock";
import { AskQuestionsCard } from "./AskQuestionsCard";
import { AskAnswersCard, parseAskAnswerText } from "./AskAnswersCard";
import { AttachmentGroup, stripMediaMarker } from "./Attachment";
import { textOf, type ChatMsg } from "../../hooks/useChat";
import { Tip } from "../ui/tip";
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
  /** Who said it. Absent → the neutral glyph (surfaces that don't know the
   *  cast). The user side draws no avatar at all: you know who you are, and a
   *  generic silhouette on every second bubble is pure noise. */
  face?: AgentFace;
}

export function MessageBubble({ msg, isLast, isAskAnswer, onCopy, face }: Props) {
  const mine = msg.role === "user";
  // A turn that carried a file shows the file; its text is the marker the agent
  // was handed, so only what the user actually wrote (caption, or the voice
  // transcript) stays as text — copy included.
  const media = mine ? msg.media : undefined;
  const copyText = media?.length ? stripMediaMarker(textOf(msg), media.length) : textOf(msg);
  const hasTools = msg.parts.some((p) => p.kind === "tool");
  // A user turn is never grouped — it has no tools, and `work` would be empty
  // anyway; splitting only shapes the assistant side.
  const { work, rest } = mine ? { work: [], rest: msg.parts } : splitTurnParts(msg.parts);

  if (mine && isAskAnswer) {
    const text = textOf(msg);
    if (parseAskAnswerText(text)) {
      return <AskAnswersCard text={text} />;
    }
  }

  return (
    <div className={cn("group flex items-start gap-2", mine ? "justify-end" : "justify-start")}>
      {!mine && (face ? (
        <AgentAvatar {...face} size={28} className="mt-0.5" />
      ) : (
        <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground">
          <Bot size={14} />
        </span>
      ))}
      {/* Both sides are capped. The user's own column used to have no max-width
          at all, so one unbroken string — a Google Docs URL pasted into a
          message — stretched the bubble past the viewport and the text ran off
          the left edge. Invisible on a wide screen, unreadable on a phone. */}
      <div className={cn("flex min-w-0 max-w-[85%] flex-col gap-1.5", mine ? "items-end" : "w-full")}>
        {/* What was actually sent: the voice note plays, the photo is the photo,
            the document opens. */}
        {media?.length ? <AttachmentGroup media={media} /> : null}

        {/* Operational notes (engine fallbacks, retries, suppressed tools). */}
        {!mine && msg.notes && msg.notes.length > 0 && (
          <div className="flex flex-col gap-0.5">
            {msg.notes.map((n, i) => (
              <span key={i} className="flex items-center gap-1 text-[10px] text-amber-600 dark:text-amber-400/80">
                <Info size={10} /> {n}
              </span>
            ))}
          </div>
        )}

        {/* Skill Inspector: which skills the per-turn RAG injected for this turn.
            Each badge opens the skill it names. */}
        {!mine && msg.inspector && <SkillTrace inspector={msg.inspector} />}

        {/* The work: every tool call and the line written before it, collapsed
            into one row. A 24-step turn is a log, not a conversation — it goes
            behind one click so the answer below is what you read first. */}
        {!mine && work.length > 0 && <ActionGroup parts={work} running={!!msg.pending} />}

        {/* What the agent said once the work was done — the answer. */}
        {rest.map((part, i) =>
          part.kind === "reasoning" ? (
            <ReasoningBlock key={i} text={part.text} streaming={part.streaming} />
          ) : part.kind === "tool" ? (
            part.tool === "ask_questions" && !mine ? (
              <AskQuestionsCard
                key={`${part.id}-${i}`}
                part={part}
                pending={!!isLast}
              />
            ) : (
              <ToolCall key={`${part.id}-${i}`} part={part} />
            )
          ) : textOfPart(part.text, media) ? (
            <div
              key={i}
              className={cn(
                // max-w-full AND overflow-wrap:anywhere. The column caps at
                // 85%, but a flex child is free to exceed its parent unless it
                // is told not to, so one unbroken string still pushed the
                // bubble past both edges of a phone with the text cut off on
                // the left. `anywhere` rather than Tailwind's `break-words`
                // (overflow-wrap: break-word) because only `anywhere` also
                // shrinks the element's MIN-CONTENT width: break-word wraps the
                // glyphs but still reports the whole URL as the narrowest the
                // box can be, so any ancestor that sizes to content — a flex
                // item, a grid cell — is laid out around the unbroken string
                // and the overflow comes back.
                "max-w-full whitespace-pre-wrap [overflow-wrap:anywhere] rounded-2xl px-3 py-2 text-sm leading-relaxed",
                mine
                  ? "rounded-br-sm bg-bubble-mine text-foreground"
                  : "w-full rounded-bl-sm bg-surface-soft text-foreground",
              )}
            >
              {textOfPart(part.text, media)}
            </div>
          ) : null,
        )}

        {/* Pending placeholder before any part has arrived. */}
        {!mine && msg.pending && msg.parts.length === 0 && (
          <div className="rounded-2xl rounded-bl-sm bg-surface-soft px-3 py-2 text-sm text-muted-foreground">
            …
          </div>
        )}

        {/* Attribution: who answered and on which engine. Always visible (not
            hover-gated) — in a thread where several agents/models take turns,
            this is the only way to tell them apart at a glance. */}
        {!mine && (msg.agent || msg.model) && (
          <div className="flex flex-wrap items-center gap-1 text-[10px]">
            {msg.agent && (
              <span className="rounded bg-emerald-500/15 px-1 py-0.5 font-medium text-emerald-700 dark:text-emerald-300">
                {msg.agent}
              </span>
            )}
            {/* Half-strength surface: the attribution sits under the bubble and
                should read as quieter than it, never as a second chip competing
                with the agent's name. The token flips per theme, so one value
                covers light and dark. */}
            {msg.model && (
              <span className="rounded bg-surface-soft/50 px-1 py-0.5 font-mono text-muted-foreground">
                {msg.model}
              </span>
            )}
          </div>
        )}

        <div className="flex items-center gap-2 text-[10px] text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100">
          <span>{formatTs(msg.ts)}</span>
          {!mine && msg.usage && (msg.usage.input_tokens || msg.usage.output_tokens) ? (
            <span className="font-mono">
              · {(msg.usage.input_tokens || 0) + (msg.usage.output_tokens || 0)} tok
            </span>
          ) : null}
          {!mine && hasTools && (
            <span>· {t("shared_ui.tools_count", { n: msg.parts.filter((p) => p.kind === "tool").length })}</span>
          )}
          {/* Replayed turns have no tool parts — the live events are gone — but
              they do carry the summary recorded at the time. Show that instead,
              so history does not look like the agent just answered from
              nothing. Failures are named: "it tried and could not" is the half
              worth surfacing. */}
          {!mine && !hasTools && msg.toolSummary?.tools?.length ? (
            <span title={msg.toolSummary.tools.map((x) => `${x.name}×${x.count}`).join(", ")}>
              · {t("shared_ui.tools_count", { n: msg.toolSummary.total })}
              {msg.toolSummary.failed
                ? ` (${t("shared_ui.tools_failed", { n: msg.toolSummary.failed })})`
                : ""}
            </span>
          ) : null}
          {onCopy && copyText && (
            <Tip content={t("chat_ui.copy")}>
              <button
                type="button"
                onClick={() => onCopy(copyText)}
                className="inline-flex items-center gap-1 hover:text-foreground"
                aria-label={t("chat_ui.copy")}
              >
                <Copy size={10} /> {t("chat_ui.copy")}
              </button>
            </Tip>
          )}
        </div>
      </div>
    </div>
  );
}

/** The visible text of a part: with attachments, the machine-facing markers
 *  are dropped and what is left (a caption, or the voice transcript) is shown. */
function textOfPart(text: string | undefined, media: unknown[] | undefined): string {
  if (!text) return "";
  return media?.length ? stripMediaMarker(text, media.length) : text;
}

function formatTs(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch {
    return iso;
  }
}
