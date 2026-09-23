import { useRef, useState } from "react";
import { modelLabel } from "../agents/modelEffort";
import { Bot, ChevronDown, CornerDownRight, Copy, Info, Pencil, RefreshCw, SquareStack } from "lucide-react";
import { cn } from "../../lib/cn";
import { AgentAvatar, type AgentFace } from "../agents/AgentAvatar";
import { ToolCall } from "./ToolCall";
import { ActionGroup, segmentTurnParts, countTurnTools, type TurnSegment } from "./ActionGroup";
import { SkillTrace } from "./SkillTrace";
import { ReasoningBlock } from "./ReasoningBlock";
import { AskQuestionsCard } from "./AskQuestionsCard";
import { AskAnswersCard, parseAskAnswerText } from "./AskAnswersCard";
import { AttachmentGroup, stripMediaMarker } from "./Attachment";
import { InteractiveOptions } from "./InteractiveOptions";
import { TurnStatus, type JobScope } from "./TurnStatus";
import { MarkdownPreview, renderMentions } from "../files/MarkdownPreview";
import { textOf, type ChatMsg, type ChatPart } from "../../hooks/useChat";
import { Tip } from "../ui/tip";
import { t } from "../../i18n";
import { useAutoGrow } from "../../hooks/useAutoGrow";

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
  /** Re-run this assistant turn (drop it and everything after, ask again).
   *  Absent → no button (super-agent threads / previews don't offer it). */
  onRegenerate?: () => void;
  /** Edit this user turn and re-send, dropping everything after it. Absent → no
   *  edit affordance. */
  onEdit?: (text: string) => void;
  /** Group style: name each speaker in a header ABOVE the bubble (with a "traído
   *  por X" tag when a mention pulled them in), the way a group chat reads. Off
   *  in a 1:1, where the single agent is already named in the header. */
  showSpeaker?: boolean;
  /** Resolve an agent slug to its display name — for the speaker header, the
   *  "traído por X" tag and every @mention inside the text. */
  nameOf?: (slug: string) => string;
  /** Full view: tool calls collapse into an ActionGroup. Simple ("pelado") view:
   *  tools hide and the narration lines that lived inside the group render as
   *  normal bubbles in order — same parts list, different layout. Default on. */
  showTools?: boolean;
  /** The list draws a day divider above each change of date, so the footer
   *  prints the time alone. Without it every older bubble has to carry its own
   *  `dd/mm`, which on a phone is what pushes the model name off the line. */
  dayInDivider?: boolean;
  /** Which chat this is, for the live status line under a running turn: it
   *  counts the background work THIS conversation left out. Absent → the line
   *  still draws, without that field. */
  jobScope?: JobScope;
}

/** How much of one message the transcript paints before asking.
 *  Well past any answer anyone writes — this is a ceiling on pathology, not a
 *  length policy. */
const LONG_TEXT_CAP = 8000;

/** `slice` that never cuts a surrogate pair in half: half an emoji is a
 *  replacement glyph, which is a rendering bug in place of the one being
 *  avoided. */
function safeSlice(text: string, n: number): string {
  if (text.length <= n) return text;
  const code = text.charCodeAt(n - 1);
  const cut = code >= 0xd800 && code <= 0xdbff ? n - 1 : n;
  return text.slice(0, cut);
}

export function MessageBubble({ msg, askPending, isAskAnswer, onCopy, face, compact, onRegenerate, onEdit, showSpeaker, nameOf, showTools = true, dayInDivider, jobScope }: Props) {
  // Hooks before any early return. The group-notice branch below returns without
  // rendering a bubble, and these two used to sit after it — so a notice arriving
  // mid-thread ("X joined the chat") changed the hook count for that row and React
  // threw "rendered more hooks than during the previous render". Group chat is
  // exactly where notices appear, so the crash was on the feature's own path.
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  // Opened by hand for a message long enough that painting it stops the tab.
  const [showAll, setShowAll] = useState(false);
  // The edit box is as tall as what's being edited. It used to size itself off
  // the number of NEWLINES in the draft, so a long message written as one
  // paragraph — which is most of them — got two squashed rows with a scrollbar.
  const editRef = useRef<HTMLTextAreaElement>(null);
  useAutoGrow(editRef, draft, { minRows: 2, maxRows: 10, viewportRatio: 0.45, boundToScroller: true, enabled: editing });

  // A group system notice ("… se sumó / salió del chat") is a centred line, not
  // a bubble, so it reads as something the room did rather than someone saying it.
  if (msg.event) {
    const who = (nameOf ? nameOf(msg.who || "") : msg.who) || msg.who || "";
    return (
      <div className="flex justify-center py-1">
        <span className="rounded-full bg-muted/50 px-3 py-0.5 text-[11px] text-muted-fg">
          {msg.event === "left" ? t("project.groups.left_chat", { name: who }) : t("project.groups.joined_chat", { name: who })}
        </span>
      </div>
    );
  }
  // A turn nobody typed. The wake-up that brings an agent back when work it left
  // running ends is filed as a user turn — that is how the agent has to read it,
  // as the next thing said to it — and drawn HERE as what it actually is. As a
  // bubble it wore the owner's face and their voice, so a page of machine
  // English addressed to the model read as something they had written
  // themselves: "¿qué es esto? no sé por qué lo veo" (Manu, 2026-09-14, on his
  // own screen). The full text stays one click away, because when a job fails
  // the output in it is the only thing that says why.
  if (msg.automation === "background_job") {
    return <BackgroundJobNotice msg={msg} />;
  }
  const mine = msg.role === "user";
  // WHO IS SPEAKING, BY NAME.
  //
  // The ledger files a group turn under the speaker's SLUG (`author: slug`, in
  // appendGroupAgentMessage) because that is the room's identity — every
  // mention, avatar and turn is addressed by it. So the header read
  // `productor-reels` while the "traído por" tag two words to its right, which
  // resolves through the roster, read "Productor Reels": the same agent, on
  // the same line, spelled two ways.
  //
  // The roster answers wherever it can. `face.name` covers the speakers it
  // cannot — the super-agent's persona, an a2a peer, a coding CLI — and the
  // stored name is the last resort, for an agent that has since been deleted.
  const speakerId = msg.agentId || msg.agent || "";
  const fromRoster = nameOf ? nameOf(speakerId) : "";
  const speakerName =
    (fromRoster && fromRoster !== speakerId ? fromRoster : "") ||
    face?.name ||
    msg.agent ||
    speakerId;
  // A turn that carried a file shows the file; its text is the marker the agent
  // was handed, so only what the user actually wrote (caption, or the voice
  // transcript) stays as text — copy included.
  //
  // Both directions. This was `mine ? msg.media : undefined`, which threw away
  // every attachment the AGENT sent: the photo it pushed to Telegram, the image
  // a routine delivered, a skill diagram it attached. The row on disk had the
  // file and the bubble dropped it on the floor — so "the agent shared a photo"
  // rendered as a bare caption, or as the placeholder text where a caption was
  // never written.
  const media = msg.media;
  const copyText = media?.length ? stripMediaMarker(textOf(msg), media.length) : textOf(msg);
  const hasTools = msg.parts.some((p) => p.kind === "tool");
  // A user turn is never grouped — it has no tools, and the segmenter would
  // return one plain part per message anyway; blocks only shape the agent side.
  //
  // The turn keeps ITS OWN count across however many blocks it happened in:
  // three tools, a sentence, three more tools is one turn of six actions, not
  // two turns of three.
  const segments = mine ? [] : segmentTurnParts(msg.parts);
  const toolTotal = mine ? 0 : countTurnTools(msg.parts);
  const blockCount = segments.filter((seg) => seg.kind === "work").length;
  // The last block is the one still working; the earlier ones already finished.
  const lastWorkAt = segments.map((seg) => seg.kind).lastIndexOf("work");
  // Simple view: same parts, no ActionGroup. Narration that lived inside the
  // work block comes out as regular bubbles; tools stay hidden (ask_questions
  // still shows — it is a control the reader must reach).
  const simpleParts = !mine && !showTools
    ? msg.parts.filter((p) =>
        p.kind === "text" ||
        p.kind === "reasoning" ||
        (p.kind === "tool" && p.tool === "ask_questions"),
      )
    : null;
  // What actually gets drawn, in order. Only the agent's full view has blocks;
  // the user's own turn and the simple view are flat lists of parts.
  const renderList: TurnSegment[] = showTools && !mine
    ? segments
    : (simpleParts || msg.parts).map((part) => ({ kind: "part", part }) as const);

  if (mine && isAskAnswer) {
    const text = textOf(msg);
    if (parseAskAnswerText(text)) {
      return <AskAnswersCard text={text} />;
    }
  }

  const startEdit = () => { setDraft(copyText); setEditing(true); };
  const submitEdit = () => {
    const v = draft.trim();
    setEditing(false);
    if (!onEdit) return;
    // Caption may be empty when the turn still has a file — editing only the
    // text of a photo message must not refuse the save.
    if (v || media?.length) onEdit(v);
  };

  // What the READER sees of a part: the attachment markers dropped, and the
  // menu's own "[Opciones: 1. … | 2. …]" line dropped too when the options are
  // being drawn as buttons right below. That line is written for the model — it
  // is how a menu is answered in words — and printing it under real buttons
  // says the same thing twice, in the uglier of the two ways.
  const visibleText = (raw: string | undefined) => {
    const text = textOfPart(raw, media);
    return msg.interactive?.options?.length ? stripMenuMarker(text) : text;
  };

  // One part of the turn, outside any block: the agent's own words, its
  // thinking, or a card that must stay in the open.
  const renderPart = (part: ChatPart, i: number) =>
    part.kind === "reasoning" ? (
      <ReasoningBlock key={i} text={part.text} streaming={part.streaming} />
    ) : part.kind === "tool" ? (
      part.tool === "ask_questions" && !mine ? (
        <AskQuestionsCard key={`${part.id}-${i}`} part={part} pending={!!askPending} />
      ) : (
        <ToolCall key={`${part.id}-${i}`} part={part} />
      )
    ) : visibleText(part.text) ? (
      <div
        key={i}
        className={cn(
          // max-w-full AND overflow-wrap:anywhere. The column caps at 85%, but
          // a flex child is free to exceed its parent unless it is told not to,
          // so one unbroken string still pushed the bubble past both edges of a
          // phone with the text cut off on the left. `anywhere` rather than
          // Tailwind's `break-words` (overflow-wrap: break-word) because only
          // `anywhere` also shrinks the element's MIN-CONTENT width:
          // break-word wraps the glyphs but still reports the whole URL as the
          // narrowest the box can be, so any ancestor that sizes to content — a
          // flex item, a grid cell — is laid out around the unbroken string and
          // the overflow comes back.
          "max-w-full [overflow-wrap:anywhere] rounded-2xl px-3 py-2 text-sm leading-relaxed",
          mine
            ? "whitespace-pre-wrap rounded-br-sm bg-bubble-mine text-foreground"
            // Agent bubble — the softer muted fill the group v1 used, now
            // shared by every chat bubble so 1:1 and group read the same.
            : "w-full rounded-bl-sm bg-muted/50 text-foreground",
        )}
      >
        {/* The agent writes markdown — **bold**, lists, `code`, links — so its
            turns render through the (dependency-free, no
            dangerouslySetInnerHTML) markdown component. The user's own bubble
            stays literal: they typed it, and reflowing their text as markdown
            would eat their asterisks and line breaks. The first/last child
            margins are zeroed so the block spacing does not double up with the
            bubble's own py-2. */}
        {(() => {
          // A BUBBLE HAS A CEILING, and it is not cosmetic.
          //
          // On 2026-09-20 a turn ended with one emoji repeated several thousand
          // times. A colour-font glyph is an image, so laying out tens of
          // thousands of them does not make the transcript slow — it stops the
          // tab, and the thread simply never appears ("no se ve el chat mejor
          // dicho el thread"). The daemon clips that at the source now
          // (core/agent/runaway-text.js), but every message written BEFORE that
          // is still on disk and is still opened every time the thread is, so
          // the surface has to survive one on its own.
          //
          // Clipped, never dropped: the rest is one click away and the button
          // says how much there is. Nothing is hidden, and nothing is a wall
          // the reader cannot get past.
          const full = visibleText(part.text);
          const over = full.length - LONG_TEXT_CAP;
          const clip = !showAll && over > 0;
          const shown = clip ? safeSlice(full, LONG_TEXT_CAP) : full;
          return (
            <>
              {mine ? renderMentions(shown, nameOf) : (
                <MarkdownPreview
                  content={shown}
                  mentions
                  nameOf={nameOf}
                  className="text-sm text-foreground [&>*:first-child]:mt-0 [&>*:last-child]:mb-0"
                />
              )}
              {clip && (
                <button
                  type="button"
                  onClick={() => setShowAll(true)}
                  className="mt-2 block text-[11px] text-muted-fg underline underline-offset-2 hover:text-foreground"
                >
                  {t("project.chat.long_clipped", { n: over })} · {t("project.chat.long_show")}
                </button>
              )}
            </>
          );
        })()}
      </div>
    ) : null;

  return (
    <div
      className={cn(
        "group flex items-start gap-2",
        mine ? "justify-end" : "justify-start",
        // Not sent yet, and it should not read as if it were: the same bubble
        // at half strength, the way a message in flight looks everywhere else.
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
          // The user's column hugs its bubble — except while editing, where it
          // takes the whole width it is allowed. A textarea's intrinsic width
          // is ~20 characters, so shrink-to-fit gave the editor a thin strip
          // regardless of how long the message being edited was.
          mine && !editing ? "items-end" : "w-full",
        )}
      >
        {/* Group style: name the speaker ABOVE the bubble, with a "traído por X"
            tag when a mention pulled them in — the way a group chat reads. */}
        {showSpeaker && !mine && (msg.agent || msg.agentId) && (
          <div className="flex items-center gap-1.5 text-[11px] leading-none">
            {/* On the phone the avatar column is dropped (see `compact`), so a
                room of four agents was four identical unmarked blocks of text.
                The face comes back here, in miniature, where it costs one line
                instead of 36px on every turn — and it gives the name the same
                left offset the desktop's column gives the bubble. */}
            {compact && (face
              ? <AgentAvatar {...face} size={16} />
              : <span className="grid size-4 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground"><Bot size={10} /></span>
            )}
            <span className="font-semibold text-foreground/90">{speakerName}</span>
            {msg.reason && (
              <span className="inline-flex items-center gap-0.5 text-muted-fg/70">
                <CornerDownRight size={11} /> {t("project.groups.pulled_by", { name: nameOf ? nameOf(msg.reason) : msg.reason })}
              </span>
            )}
            {/* An agent's words that reached the other side as the owner's.
                Beside the name, not instead of it: both halves are true and
                dropping either one is a lie about who spoke. */}
            {msg.onBehalfOf && (
              <span className="shrink-0 rounded bg-sky-500/15 px-1 py-px text-[10px] font-medium text-sky-700 dark:text-sky-300">
                {t("mobile.runtimes_on_behalf")}
              </span>
            )}
          </div>
        )}

        {/* What was actually sent: the voice note plays, the photo is the photo,
            the document opens. */}
        {media?.length ? <AttachmentGroup media={media} /> : null}


        {/* Operational notes (engine fallbacks, retries, suppressed tools).
            Top-aligned and wrapping: a note now carries the REASON an engine
            rotated, which is a sentence, not a word — centred on a single line
            it either overflowed or squashed the icon. */}
        {!mine && msg.notes && msg.notes.length > 0 && (
          <div className="flex flex-col gap-0.5">
            {msg.notes.map((n, i) => (
              <span key={i} className="flex items-start gap-1 text-[10px] text-amber-600 dark:text-amber-400/80">
                <Info size={10} className="mt-[2px] shrink-0" />
                <span className="min-w-0 break-words">{n}</span>
              </span>
            ))}
          </div>
        )}

        {/* Skill Inspector: which skills the per-turn RAG injected for this turn.
            Each badge opens the skill it names. */}
        {!mine && msg.inspector && <SkillTrace inspector={msg.inspector} />}

        {/* Editing your own turn in place: on save it re-sends and everything
            below is dropped and re-answered. Enter saves, Esc/Cancel backs out. */}
        {mine && editing && (
          <div className="flex w-full flex-col gap-1.5">
            <textarea
              ref={editRef}
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submitEdit(); }
                if (e.key === "Escape") setEditing(false);
              }}
              // Floor for the first paint, before the hook measures; after that
              // the height it sets wins.
              rows={2}
              className="w-full resize-none rounded-2xl rounded-br-sm border border-primary/40 bg-bubble-mine px-3 py-2 text-sm leading-relaxed text-foreground outline-none focus:border-primary"
            />
            <div className="flex items-center justify-end gap-2 text-xs">
              <button type="button" onClick={() => setEditing(false)} className="rounded px-2 py-1 text-muted-foreground hover:text-foreground">
                {t("common.cancel")}
              </button>
              <button type="button" onClick={submitEdit} disabled={!draft.trim()} className="rounded bg-primary px-2 py-1 font-medium text-primary-foreground disabled:opacity-50">
                {t("chat_ui.edit_resend")}
              </button>
            </div>
          </div>
        )}
        {/* The turn in the order it happened: a run of tool calls collapses into
            one block, and what the agent SAID between the runs stands outside
            them, as the message it is. A 24-step turn is still a log rather
            than a screenful of cards — but the reader can now see WHERE in the
            turn each thing was said, instead of only the closing line with
            everything before it inside one box.

            Simple view has no blocks at all: every text/reasoning part in
            original order, tools hidden (ask_questions still shows — it is a
            control the reader must reach). */}
        {!(mine && editing) && renderList.map((seg, si) =>
          seg.kind === "work" ? (
            <ActionGroup
              key={`work-${si}`}
              parts={seg.parts}
              // Only the LAST block is still working; the ones above it have
              // already finished, and a spinner on each would say otherwise.
              running={!!msg.pending && si === lastWorkAt}
              // Numbered against the TURN, not the block: a second block
              // starting over at "1 action" would read as a second turn. A turn
              // with one block just says how many — "1–4 of 4" is noise.
              range={blockCount > 1 ? { from: seg.from, to: seg.to, total: toolTotal } : undefined}
            />
          ) : (
            renderPart(seg.part, si)
          ),
        )}

        {/* A menu the message OFFERED — WhatsApp buttons, a list, a template.
            UNDER the text, because that is where they are on the phone: the
            question first, then what you can tap. The stored text also names
            the options inline (that is how a model answers a menu, by writing
            "2"); with real buttons on screen that line is noise, and
            `menuText` drops it. */}
        {msg.interactive?.options?.length ? <InteractiveOptions menu={msg.interactive} /> : null}
        {/* Still going. Not just before the first part arrives: a turn that has
            been running shell commands for two minutes shows a list of finished
            steps and nothing that says more is coming, so it reads as an answer
            that stopped mid-thought. The pill stays for the whole turn and goes
            when the turn does. */}
        {!mine && msg.pending && (
          <TurnStatus
            msg={msg}
            face={face}
            name={face?.name || msg.agent || undefined}
            jobScope={jobScope}
            compact={compact}
          />
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
          {/* In a group the speaker is named ABOVE the bubble, so the footer drops
              the green name chip and keeps only model/time/cost. */}
          {!mine && msg.agent && !showSpeaker && (
            <span className="shrink-0 rounded bg-emerald-500/15 px-1 py-0.5 font-medium text-emerald-700 dark:text-emerald-300">
              {speakerName}
            </span>
          )}
          {/* Half-strength surface: the attribution sits under the bubble and
              should read as quieter than it, never as a second chip competing
              with the agent's name. The token flips per theme, so one value
              covers light and dark. */}
          {!mine && msg.model && (
            <span className="min-w-0 truncate rounded bg-surface-soft/50 px-1 py-0.5 font-mono text-muted-foreground">
              {modelLabel(msg.model)}
            </span>
          )}
          <div
            className={cn(
              "ml-auto flex shrink-0 items-center gap-2 text-muted-foreground",
              // The phone has no hover, so there it is simply always on.
              !compact && "opacity-0 transition-opacity group-hover:opacity-100",
            )}
          >
            {/* Every bubble here has gone out, so every one has a real
                timestamp. A parked line never reaches this component any more —
                it is drawn above the field (components/chat/PendingTurns.tsx),
                where "not sent yet" is what its position says rather than
                something a small clock on a normal-looking bubble has to. */}
            <span>{formatTs(msg.ts, compact, dayInDivider)}</span>
            {/* The sum is what fits; the split is what you actually want when
                a turn looks expensive. One tap/hover away rather than three
                more numbers on a line that already wraps on a phone. */}
            {!mine && msg.usage && (msg.usage.input_tokens || msg.usage.output_tokens) ? (
              <Tip
                content={t("shared_ui.tokens_detail", {
                  in: fmtTok(msg.usage.input_tokens || 0),
                  out: fmtTok(msg.usage.output_tokens || 0),
                })}
              >
                <span className="font-mono">
                  · {fmtTok((msg.usage.input_tokens || 0) + (msg.usage.output_tokens || 0))} tok
                </span>
              </Tip>
            ) : null}
            {/* The COUNT stands in both views, unlike the log it counts.
                Simple view used to hide this too, so a phone — which starts
                pelado — showed a one-line answer with no sign that twelve
                shell commands went into it, and nothing to suggest the header
                switch had anything to show. The steps stay hidden; that the
                agent took them does not. */}
            {!mine && hasTools && (
              <span data-testid="turn-tools-count">
                · {t("shared_ui.tools_count", { n: msg.parts.filter((p) => p.kind === "tool").length })}
              </span>
            )}
            {/* Replayed turns have no tool parts — the live events are gone —
                but they do carry the summary recorded at the time. Show that
                instead, so history does not look like the agent just answered
                from nothing. Failures are named: "it tried and could not" is
                the half worth surfacing. */}
            {!mine && !hasTools && msg.toolSummary?.tools?.length ? (
              <Tip content={msg.toolSummary.tools.map((x) => `${x.name}×${x.count}`).join(", ")}>
                <span>
                  · {t("shared_ui.tools_count", { n: msg.toolSummary.total })}
                  {msg.toolSummary.failed
                    ? ` (${t("shared_ui.tools_failed", { n: msg.toolSummary.failed })})`
                    : ""}
                </span>
              </Tip>
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
            {/* Edit your turn and re-ask (drops everything below). */}
            {mine && onEdit && !editing && (
              <Tip content={t("chat_ui.edit")}>
                <button
                  type="button"
                  onClick={startEdit}
                  className="inline-flex items-center gap-1 hover:text-foreground"
                  aria-label={t("chat_ui.edit")}
                >
                  <Pencil size={10} /> {!compact && t("chat_ui.edit")}
                </button>
              </Tip>
            )}
            {/* Re-run this answer (drops it and everything below). */}
            {!mine && onRegenerate && (
              <Tip content={t("chat_ui.regenerate")}>
                <button
                  type="button"
                  onClick={onRegenerate}
                  className="inline-flex items-center gap-1 hover:text-foreground"
                  aria-label={t("chat_ui.regenerate")}
                >
                  <RefreshCw size={10} /> {!compact && t("chat_ui.regenerate")}
                </button>
              </Tip>
            )}
          </div>
        </div>}
      </div>
    </div>
  );
}

/** The inline options line, as `describeInteractive` writes it. Anchored to the
 *  end because that is where it is appended, and matched loosely on the label so
 *  a menu decoded in either language reads the same. */
const MENU_MARKER = /\n?\[(?:Opciones|Options):[^\]]*\]\s*$/;

function stripMenuMarker(text: string): string {
  return text.replace(MENU_MARKER, "").trimEnd();
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

function formatTs(iso: string, compact?: boolean, dayInDivider?: boolean): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    // Seconds are for reading a live stream on a desktop; on the phone they are
    // three more characters competing with the model's name for the same line.
    const time = d.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      ...(compact ? {} : { second: "2-digit" }),
    });
    // Today → time only. Older (or future) days keep the date so a scrolled
    // thread is readable without opening a calendar — UNLESS the list is
    // drawing day dividers, in which case the day is already named above the
    // first message of it and every footer repeating it is noise.
    if (dayInDivider) return time;
    const now = new Date();
    const sameDay =
      d.getFullYear() === now.getFullYear() &&
      d.getMonth() === now.getMonth() &&
      d.getDate() === now.getDate();
    if (sameDay) return time;
    const date = d.toLocaleDateString([], {
      day: "2-digit",
      month: "2-digit",
      ...(d.getFullYear() !== now.getFullYear() ? { year: "2-digit" } : {}),
    });
    return `${date} ${time}`;
  } catch {
    return iso;
  }
}

/**
 * The machine bringing an agent back, drawn as what it is.
 *
 * A background job's wake-up is FILED as a user turn — that is the only way the
 * agent reads it as the next thing said to it, and the only way it survives in
 * the thread's history. But it is not something the owner said, and the text is
 * written for a model: an English recap of the command, the exit code and the
 * tail of the output, several hundred words of it. In a bubble, in the owner's
 * own colour, it reads as a wall of text they apparently pasted into their own
 * chat.
 *
 * So: one line by default, with the outcome the fields carry (never parsed back
 * out of the prose), and the whole notice one click away — because when a job
 * fails, the output inside it is the only thing that says why.
 */
function BackgroundJobNotice({ msg }: { msg: ChatMsg }) {
  const [open, setOpen] = useState(false);
  const job = msg.job;
  const failed = (job?.status || "") !== "done";
  const why = job?.exit_code != null && job.exit_code !== 0 ? `exit ${job.exit_code}` : job?.status || "";

  return (
    <div className="flex justify-center py-1">
      <div className="w-full max-w-[85%] rounded-lg border border-border bg-muted/30 px-3 py-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          data-testid="job-wake-notice"
          className="flex w-full items-center gap-2 text-left text-[11px] text-muted-fg hover:text-foreground"
        >
          <SquareStack size={12} className="shrink-0" />
          <span className="shrink-0 font-medium">
            {failed ? t("chat_ui.job_wake_failed") : t("chat_ui.job_wake_done")}
          </span>
          {why && (
            <span className={cn("shrink-0 rounded px-1 tabular-nums", failed ? "bg-destructive/15 text-destructive" : "bg-muted text-muted-fg")}>
              {why}
            </span>
          )}
          {job?.command && <span className="min-w-0 flex-1 truncate font-mono opacity-70">{job.command}</span>}
          <ChevronDown size={12} className={cn("ml-auto shrink-0 transition-transform", open && "rotate-180")} />
        </button>
        {open && (
          <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap [overflow-wrap:anywhere] border-t border-border pt-2 text-[11px] leading-snug text-muted-fg">
            {textOf(msg)}
          </pre>
        )}
      </div>
    </div>
  );
}
