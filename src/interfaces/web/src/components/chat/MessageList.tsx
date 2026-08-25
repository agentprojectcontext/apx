import { useEffect, useRef } from "react";
import { MessageBubble } from "./MessageBubble";
import { pendingAskIndex } from "./InlineAskPanel";
import { Empty } from "../ui";
import { t } from "../../i18n";
import type { AgentFace } from "../agents/AgentAvatar";
import type { ChatMsg, QueuedTurn } from "../../hooks/useChat";

interface Props {
  msgs: ChatMsg[];
  /** Written while the current turn is still running, waiting behind it. They
   *  are drawn at the foot of the thread, where they will land. */
  queued?: QueuedTurn[];
  onUnqueue?: (id: string) => void;
  onCopy: (text: string) => void;
  /** Re-run the answer at this index (drop it and everything after). Absent →
   *  no regenerate affordance (super-agent threads, a2a, previews). */
  onRegenerate?: (index: number) => void;
  /** Edit the user message at this index and re-send (drop everything after). */
  onEdit?: (index: number, text: string) => void;
  /** Who to draw next to an assistant turn. Screens that know the cast (chat,
   *  inbox) pass it; the rest fall back to a neutral glyph. */
  faceFor?: (msg: ChatMsg) => AgentFace;
  /** Group style: name each speaker above their bubble, with a "traído por X"
   *  tag. Off in a 1:1. */
  showSpeaker?: boolean;
  /** Resolve an agent slug to a display name (for the "traído por X" tag). */
  nameOf?: (slug: string) => string;
  /** Smooth-scroll to the latest turn. Nested previews turn this off. */
  autoscroll?: boolean;
  /** Height of whatever floats over the bottom of the thread (the composer
   *  dock). Rendered as trailing space so the last line of the conversation can
   *  always be scrolled clear of it. */
  bottomInset?: number;
  /** Phone shaping: no per-bubble avatar, wider bubbles. On 390px the face is
   *  36px of width spent repeating something the header already says. */
  compact?: boolean;
  /** Told when the reader arrives at, or leaves, the bottom of the thread — so
   *  the host can offer a way back down while they are away from it. */
  onAtBottomChange?: (atBottom: boolean) => void;
}

/** How close to the end still counts as being at it. A couple of lines of
 *  slack: a sub-pixel scroll position or a rounding here and there should not
 *  be what decides whether the next turn follows you. */
const AT_BOTTOM_SLACK = 24;

export function MessageList({
  msgs,
  queued = [],
  onUnqueue,
  onCopy,
  onRegenerate,
  onEdit,
  faceFor,
  showSpeaker,
  nameOf,
  autoscroll = true,
  bottomInset = 0,
  compact,
  onAtBottomChange,
}: Props) {
  const bottomRef = useRef<HTMLDivElement | null>(null);
  // Whether the reader is at the end. Read synchronously by the effect below,
  // so it has to be a ref rather than state.
  const pinned = useRef(true);
  // What the host has been told, separately from what is true. Comparing
  // against `pinned` alone swallowed the FIRST measurement whenever it happened
  // to agree with the initial guess — and on a remount that left a host still
  // showing "you are away from the bottom" for a list sitting at the bottom,
  // with nothing that would ever correct it.
  const reported = useRef<boolean | undefined>(undefined);
  // Held in a ref so a host that hands over a fresh closure on every render
  // does not tear down and rebuild the scroll listener underneath it.
  const notify = useRef(onAtBottomChange);
  notify.current = onAtBottomChange;

  // Who owns "am I at the bottom", and the two things that follow from it.
  //
  // The dock over the bottom changes height while you use it — a draft wraps to
  // a second line, the context panel opens, an attachment appears. Growing the
  // trailing space alone would slide the last message underneath it, so a
  // reader who was AT the bottom is carried back down. A reader who had
  // scrolled up to re-read something is not.
  useEffect(() => {
    const el = bottomRef.current;
    if (!el || !autoscroll) return;
    const scroller = scrollParentOf(el);
    if (!scroller) return;
    const measure = () => {
      const at = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < AT_BOTTOM_SLACK;
      pinned.current = at;
      if (at === reported.current) return;
      reported.current = at;
      notify.current?.(at);
    };
    // Deliberately NOT measured here. At mount the list has not landed yet, so
    // the honest answer is "miles from the bottom" — which would both flash the
    // way-back button and, worse, tell the effect below not to land at all.
    scroller.addEventListener("scroll", measure, { passive: true });
    const ro = new ResizeObserver(() => {
      if (pinned.current) el.scrollIntoView({ block: "end" });
    });
    ro.observe(el);
    return () => {
      scroller.removeEventListener("scroll", measure);
      ro.disconnect();
    };
  }, [autoscroll]);

  // A new turn follows the reader ONLY if the reader was already following it.
  //
  // This used to fire on every change to `msgs`, full stop: you scrolled up to
  // re-read something, one more word arrived, and you were thrown back to the
  // bottom mid-sentence. Leaving the end is a decision, and a message arriving
  // is not a reason to overrule it — the way back down is offered instead, by
  // whoever is hosting this list.
  const landed = useRef(false);
  useEffect(() => {
    if (!autoscroll) return;
    // Opening a thread lands at the latest. That is where a conversation is
    // read from — not a preference to be inferred from a scroll position that
    // does not exist yet.
    if (!landed.current) {
      landed.current = true;
      bottomRef.current?.scrollIntoView({ block: "end" });
      return;
    }
    if (!pinned.current) return;
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [msgs, queued, autoscroll]);

  if (msgs.length === 0 && queued.length === 0) {
    return (
      <div className="grid h-full place-items-center p-6">
        <Empty>{t("project.chat.empty")}</Empty>
      </div>
    );
  }

  // Which turn's questions are still open — the one the composer is offering to
  // answer. Everything else with an ask_questions call in it has been settled.
  const askAt = pendingAskIndex(msgs);
  return (
    <div className="space-y-4 px-3 py-4">
      {msgs.map((m, i) => (
        <MessageBubble
          key={i}
          msg={m}
          askPending={i === askAt}
          isAskAnswer={isAnswerToAsk(msgs, i)}
          onCopy={onCopy}
          onRegenerate={onRegenerate && m.role === "assistant" ? () => onRegenerate(i) : undefined}
          onEdit={onEdit && m.role === "user" ? (text) => onEdit(i, text) : undefined}
          compact={compact}
          face={m.role === "assistant" ? faceFor?.(m) : undefined}
          showSpeaker={showSpeaker}
          nameOf={nameOf}
        />
      ))}
      {/* Waiting their turn, under the answer they will follow. Same bubble as
          any other — what you wrote is in the conversation the moment you send
          it, whether or not the agent has got to it yet. */}
      {queued.map((q) => (
        <MessageBubble
          key={q.id}
          msg={q.msg}
          onCopy={onCopy}
          compact={compact}
          queued
          onUnqueue={onUnqueue ? () => onUnqueue(q.id) : undefined}
        />
      ))}
      <div ref={bottomRef} style={bottomInset ? { height: bottomInset } : undefined} />
    </div>
  );
}

/** The nearest ancestor that actually scrolls. */
function scrollParentOf(el: HTMLElement): HTMLElement | null {
  let p = el.parentElement;
  while (p) {
    const oy = getComputedStyle(p).overflowY;
    if (oy === "auto" || oy === "scroll") return p;
    p = p.parentElement;
  }
  return null;
}

// A user message is an "ask answer" when an unanswered ask_questions call stood
// immediately before it — allowing for the line the agent says alongside its
// questions, which is a turn of its own and used to break the match. The
// InlineAskPanel compiles the user's picks into a single text reply, which we
// then render as a centered full-width card instead of the standard
// right-aligned user bubble.
function isAnswerToAsk(msgs: ChatMsg[], i: number): boolean {
  const m = msgs[i];
  if (!m || m.role !== "user") return false;
  return pendingAskIndex(msgs.slice(0, i)) >= 0;
}
