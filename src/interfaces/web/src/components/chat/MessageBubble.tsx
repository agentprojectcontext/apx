import { Bot, Clock, Copy, Info, X } from "lucide-react";
import { cn } from "../../lib/cn";
import { AgentAvatar, type AgentFace } from "../agents/AgentAvatar";
import { ToolCall } from "./ToolCall";
import { ActionGroup, splitTurnParts } from "./ActionGroup";
import { SkillTrace } from "./SkillTrace";
import { ReasoningBlock } from "./ReasoningBlock";
import { AskQuestionsCard } from "./AskQuestionsCard";
import { AskAnswersCard, parseAskAnswerText } from "./AskAnswersCard";
import { AttachmentGroup, stripMediaMarker } from "./Attachment";
import { MarkdownPreview } from "../files/MarkdownPreview";
import { textOf, type ChatMsg } from "../../hooks/useChat";
import { Tip } from "../ui/tip";
import { t } from "../../i18n";

interface Props {
  msg: ChatMsg;
  /** True when THIS turn's ask_questions call is the one still waiting for an
   *  answer. Decided by the list, which can see whether a user message came
   *  after it; a turn cannot tell on its own. */
  askPending?: boolean;
  /** True when this user message is the reply to a preceding `ask_questions`
   *  call. Renders as a full-width centered card instead of the user bubble. */
  isAskAnswer?: boolean;
  onCopy?: (text: string) => void;
  /** Who said it. Absent → the neutral glyph (surfaces that don't know the
   *  cast). The user side draws no avatar at all: you know who you are, and a
   *  generic silhouette on every second bubble is pure noise. */
  face?: AgentFace;
  /** Phone shaping: drop the avatar column and let the bubble have the width.
   *  On a 390px screen the face costs 36px on EVERY assistant turn to repeat
   *  the name already standing in the header, three inches above. */
  compact?: boolean;
  /** Written while the previous turn was still running: it is in the thread but
   *  has not left yet. Drawn at half strength, and it says so. */
  queued?: boolean;
  /** Take it back before it goes. Only meaningful alongside `queued`. */
  onUnqueue?: () => void;
}

export function MessageBubble({ msg, askPending, isAskAnswer, onCopy, face, compact, queued, onUnqueue }: Props) {
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
    <div
      className={cn(
        "group flex items-start gap-2",
        mine ? "justify-end" : "justify-start",
        // Not sent yet, and it should not read as if it were: the same bubble
        // at half strength, the way a message in flight looks everywhere else.
        queued && "opacity-55",
      )}
    >
      {!mine && !compact && (face ? (
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
      <div
        className={cn(
          "flex min-w-0 flex-col gap-1.5",
          compact ? "max-w-[92%]" : "max-w-[85%]",
          mine ? "items-end" : "w-full",
        )}
      >
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
                pending={!!askPending}
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
                "max-w-full [overflow-wrap:anywhere] rounded-2xl px-3 py-2 text-sm leading-relaxed",
                mine
                  ? "whitespace-pre-wrap rounded-br-sm bg-bubble-mine text-foreground"
                  : "w-full rounded-bl-sm bg-surface-soft text-foreground",
              )}
            >
              {/* The agent writes markdown — **bold**, lists, `code`, links —
                  so its turns render through the (dependency-free, no
                  dangerouslySetInnerHTML) markdown component. The user's own
                  bubble stays literal: they typed it, and reflowing their text
                  as markdown would eat their asterisks and line breaks. The
                  first/last child margins are zeroed so the block spacing does
                  not double up with the bubble's own py-2. */}
              {mine ? (
                textOfPart(part.text, media)
              ) : (
                <MarkdownPreview
                  content={textOfPart(part.text, media)}
                  className="text-sm text-foreground [&>*:first-child]:mt-0 [&>*:last-child]:mb-0"
                />
              )}
            </div>
          ) : null,
        )}

        {/* Still going. Not just before the first part arrives: a turn that has
            been running shell commands for two minutes shows a list of finished
            steps and nothing that says more is coming, so it reads as an answer
            that stopped mid-thought. The pill stays for the whole turn and goes
            when the turn does. */}
        {!mine && msg.pending && (
          <Typing label={msg.parts.length === 0 ? t("chat_ui.typing") : t("chat_ui.working")} />
        )}

        {/* One line under the bubble: who answered on the left, when it did and
            what it cost on the right. They used to be two stacked rows with the
            second one hover-only, which on a phone means it does not exist.
            Nothing at all while the turn is still running: a lone timestamp
            under "escribiendo…" is a receipt for a message that has not
            arrived yet. It appears with the answer. */}
        {!(!mine && msg.pending) && <div
          className={cn(
            "flex w-full items-center gap-x-2 gap-y-1 text-[10px]",
            // On a phone the row may not wrap: the whole point is that the meta
            // stands BESIDE the attribution, and "zen:deepseek-v4-flash-free"
            // alone fills 390px, so letting it wrap puts the data back under the
            // bubble where it started. The model gives up the room instead — it
            // is the one field here also spelled out in the context panel.
            compact ? "flex-nowrap" : "flex-wrap",
            mine && "justify-end",
          )}
        >
          {!mine && msg.agent && (
            <span className="shrink-0 rounded bg-emerald-500/15 px-1 py-0.5 font-medium text-emerald-700 dark:text-emerald-300">
              {msg.agent}
            </span>
          )}
          {/* Half-strength surface: the attribution sits under the bubble and
              should read as quieter than it, never as a second chip competing
              with the agent's name. The token flips per theme, so one value
              covers light and dark. */}
          {!mine && msg.model && (
            <span className="min-w-0 truncate rounded bg-surface-soft/50 px-1 py-0.5 font-mono text-muted-foreground">
              {msg.model}
            </span>
          )}
          <div
            className={cn(
              "ml-auto flex shrink-0 items-center gap-2 text-muted-foreground",
              // The phone has no hover, so there it is simply always on. So is
              // the queue line — "waiting its turn, here is how to take it
              // back" is not something to hide behind a hover.
              !compact && !queued && "opacity-0 transition-opacity group-hover:opacity-100",
            )}
          >
            {/* A timestamp on a turn that has not gone out yet is a receipt for
                something that did not happen. What it is waiting for takes the
                slot instead, until it leaves and gets a real one. */}
            {queued ? (
              <span className="inline-flex items-center gap-1">
                <Clock size={10} /> {t("chat_ui.queued")}
              </span>
            ) : (
              <span>{formatTs(msg.ts, compact)}</span>
            )}
            {queued && onUnqueue && (
              <Tip content={t("chat_ui.queued_cancel")}>
                <button
                  type="button"
                  onClick={onUnqueue}
                  className="inline-flex items-center hover:text-foreground"
                  aria-label={t("chat_ui.queued_cancel")}
                >
                  <X size={11} />
                </button>
              </Tip>
            )}
            {!mine && msg.usage && (msg.usage.input_tokens || msg.usage.output_tokens) ? (
              <span className="font-mono">
                · {fmtTok((msg.usage.input_tokens || 0) + (msg.usage.output_tokens || 0))} tok
              </span>
            ) : null}
            {!mine && hasTools && (
              <span>· {t("shared_ui.tools_count", { n: msg.parts.filter((p) => p.kind === "tool").length })}</span>
            )}
            {/* Replayed turns have no tool parts — the live events are gone —
                but they do carry the summary recorded at the time. Show that
                instead, so history does not look like the agent just answered
                from nothing. Failures are named: "it tried and could not" is
                the half worth surfacing. */}
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
                  <Copy size={10} /> {!compact && t("chat_ui.copy")}
                </button>
              </Tip>
            )}
          </div>
        </div>}
      </div>
    </div>
  );
}

/** "escribiendo…" / "trabajando…" — the word in the reader's language, with the
 *  dots doing the waiting. Three spans on staggered delays rather than a CSS
 *  animation of the text itself, so a screen reader gets one stable label
 *  instead of a glyph that changes three times a second. */
function Typing({ label }: { label: string }) {
  return (
    // w-fit, not the stretched full-width bubble every other assistant turn
    // gets: a two-word status painted across the whole column reads as a
    // message that arrived empty.
    <div className="flex w-fit items-center gap-1.5 self-start rounded-2xl rounded-bl-sm bg-surface-soft px-3 py-2 text-sm text-muted-foreground">
      <span>{label}</span>
      <span aria-hidden className="flex items-center gap-[3px]">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="size-1 animate-bounce rounded-full bg-current"
            style={{ animationDelay: `${i * 140}ms`, animationDuration: "1s" }}
          />
        ))}
      </span>
    </div>
  );
}

/** The visible text of a part: with attachments, the machine-facing markers
 *  are dropped and what is left (a caption, or the voice transcript) is shown. */
function textOfPart(text: string | undefined, media: unknown[] | undefined): string {
  if (!text) return "";
  return media?.length ? stripMediaMarker(text, media.length) : text;
}

/** 1219686 → "1.2M". The raw count fit while the row was hover-only and had the
 *  bubble's whole width; now it shares a line with the agent and the model on a
 *  390px screen, where seven digits are what pushes the row onto two. */
function fmtTok(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function formatTs(iso: string, compact?: boolean): string {
  try {
    const d = new Date(iso);
    // Seconds are for reading a live stream on a desktop; on the phone they are
    // three more characters competing with the model's name for the same line.
    return d.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      ...(compact ? {} : { second: "2-digit" }),
    });
  } catch {
    return iso;
  }
}
