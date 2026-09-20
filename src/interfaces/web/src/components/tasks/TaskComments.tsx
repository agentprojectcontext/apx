import { useEffect, useMemo, useRef, useState } from "react";
import { AtSign, Send } from "lucide-react";
import { Tasks } from "../../lib/api";
import { Button, Textarea } from "../ui";
import { AgentAvatar } from "../agents/AgentAvatar";
import { useToast } from "../Toast";
import { relativeWhen } from "../../lib/when";
import { SUPER_AGENT_SLUG, useMentionables } from "./useMentionables";
import { useLiveMessages } from "../../hooks/useLiveMessages";
import { cn } from "../../lib/cn";
import { t } from "../../i18n";
import type { AgentFace, TaskComment } from "../../types/daemon";

/**
 * The task's comment thread, plus the box that writes to it.
 *
 * IT DOES NOT GROW THE PANEL. The thread scrolls inside a fixed height and the
 * composer stays pinned under it, because the point of a comment is to sit
 * NEXT to a task you can still read — a thread that pushes the description,
 * the subtasks and the dates off screen has replaced the thing it annotates.
 *
 * @-mentioning an agent hands it the task: it runs a real turn with its own
 * tools and writes back another comment. That happens server-side and takes as
 * long as the work takes, so the POST returns as soon as YOUR comment is
 * stored and the reply arrives later — PUSHED, not polled. The cascade already
 * announces every comment it writes on the live feed (core/tasks/comment-turn
 * emits a message event carrying the task id as its thread), so the thread
 * listens instead of asking. It used to re-fetch every 4s for three minutes,
 * and because the parent's `onChanged` also refreshes the board, a summoned
 * agent turned the whole Tasks screen into something that blinked at you.
 *
 * WHO YOU CAN MENTION IS SHOWN, not remembered. Typing "@" opens the roster and
 * a tap completes it. The feature was unusable anywhere you could not already
 * recite the slugs — which on a phone is everywhere: the hint said "mention an
 * agent with @" and then asked you to guess the handle.
 */
const THREAD_MAX_H = "max-h-72";

function authorName(by: string | null, faces: Map<string, AgentFace>) {
  if (!by || by === "owner") return t("tasks.comment_owner");
  return faces.get(by)?.name || by;
}

/**
 * The "@word" being typed at the caret, if any.
 *
 * Only ever the token the caret is INSIDE, and only when it starts the word —
 * an email address in the middle of a sentence is not a mention, and neither is
 * an "@" you already finished and walked away from.
 */
function mentionAt(text: string, caret: number): { from: number; query: string } | null {
  const upto = text.slice(0, caret);
  const at = upto.lastIndexOf("@");
  if (at < 0) return null;
  if (at > 0 && !/\s/.test(upto[at - 1])) return null;
  const query = upto.slice(at + 1);
  if (/[\s@]/.test(query)) return null;
  return { from: at, query };
}

export function TaskComments({
  pid, taskId, comments, onChanged,
}: {
  pid: string;
  taskId: string;
  comments: TaskComment[];
  /** Re-fetch the task — the thread lives on it. */
  onChanged: () => void;
}) {
  const toast = useToast();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  // Open with no query = the "@" button was pressed; a query = it is being typed.
  const [picking, setPicking] = useState<{ from: number; query: string } | null>(null);
  const scroller = useRef<HTMLDivElement | null>(null);
  const box = useRef<HTMLTextAreaElement | null>(null);

  // One request for the roster, shared with every other screen on this project,
  // plus the super-agent. It is what lets a comment wear the agent's real face
  // instead of an initial, and what the mention list is drawn from.
  const roster = useMentionables(pid);
  const faces = useMemo(
    () => new Map<string, AgentFace>(roster.map((a) => [a.slug!, a])),
    [roster],
  );

  const q = (picking?.query ?? "").toLowerCase();
  const matches = useMemo(
    () => (picking
      ? roster.filter((a) =>
          !q || `${a.slug} ${a.name}`.toLowerCase().includes(q))
      : []),
    [picking, q, roster],
  );

  // Newest comment in view. A thread you have to scroll to see the reply you
  // just triggered is a thread that looks broken.
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [comments.length]);

  /**
   * A summoned agent's reply, pushed.
   *
   * comment-turn.js announces every comment it writes with the TASK id in the
   * event's `thread` — the one place on the a2a channel where that field is not
   * a day file — so "did my task move" is an exact match and not a guess. A
   * resync (the socket was down) revalidates once, like everywhere else.
   *
   * Always on, not armed by a send: the reply can also come from a cascade
   * somebody else started, from the phone, or from a routine. The socket is the
   * panel's one shared connection, so listening costs nothing.
   */
  useLiveMessages((events) => {
    if (events.some((ev) => ev.scope === "resync" || ev.thread === taskId)) onChanged();
  });

  const type = (value: string, caret: number) => {
    setText(value);
    setPicking(mentionAt(value, caret));
  };

  /** Swap the half-typed "@qa" for the real handle and a trailing space. */
  const complete = (slug: string) => {
    const at = picking?.from ?? text.length;
    const after = at + 1 + (picking?.query.length ?? 0);
    const next = `${text.slice(0, at)}@${slug} ${text.slice(after)}`;
    setText(next);
    setPicking(null);
    // The caret belongs after what was just inserted, or the next keystroke
    // lands wherever it happened to be and re-opens the picker.
    requestAnimationFrame(() => {
      const el = box.current;
      if (!el) return;
      const pos = at + slug.length + 2;
      el.focus();
      el.setSelectionRange(pos, pos);
    });
  };

  /** The "@" button: the phone has no keyboard shortcut and no hover. */
  const openPicker = () => {
    const el = box.current;
    const caret = el?.selectionStart ?? text.length;
    const pad = caret > 0 && !/\s$/.test(text.slice(0, caret)) ? " " : "";
    const next = `${text.slice(0, caret)}${pad}@${text.slice(caret)}`;
    setText(next);
    setPicking({ from: caret + pad.length, query: "" });
    requestAnimationFrame(() => {
      const pos = caret + pad.length + 1;
      box.current?.focus();
      box.current?.setSelectionRange(pos, pos);
    });
  };

  const send = async () => {
    const body = text.trim();
    if (!body || busy) return;
    setBusy(true);
    try {
      const { summoned } = await Tasks.comment(pid, taskId, body);
      setText("");
      setPicking(null);
      onChanged();
      if (summoned?.length) {
        toast.info(t("tasks.comment_summoned", { who: summoned.map((s) => `@${s}`).join(", ") }));
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.error_generic"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-1.5">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-fg">
        {t("tasks.comments_title")}{comments.length ? ` (${comments.length})` : ""}
      </div>

      <div className="overflow-hidden rounded-lg border border-border">
        {comments.length > 0 && (
          <div ref={scroller} className={cn("space-y-2 overflow-y-auto p-2.5", THREAD_MAX_H)} data-testid="task-comments">
            {comments.map((c) => (
              <div key={c.id} className="flex gap-2">
                <div className="mt-0.5 shrink-0">
                  {c.by && c.by !== "owner"
                    ? <AgentAvatar {...(faces.get(c.by) ?? { name: c.by })} size={20} />
                    : <span className="flex size-5 items-center justify-center rounded-full bg-primary/20 text-[9px] font-semibold uppercase">
                        {t("tasks.comment_owner").slice(0, 2)}
                      </span>}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2 text-[10px] text-muted-fg">
                    <span className="font-medium text-fg">{authorName(c.by, faces)}</span>
                    <span title={new Date(c.ts).toLocaleString()}>{relativeWhen(c.ts, t as never)}</span>
                  </div>
                  <div className="whitespace-pre-wrap break-words text-xs">{c.text}</div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* The roster, ABOVE the composer: on a phone the keyboard owns the
            bottom half of the screen, and a list under the box is behind it. */}
        {picking && (
          <div
            data-testid="task-mention-list"
            className={cn(
              "max-h-44 overflow-y-auto border-t border-border bg-muted/20 p-1",
              comments.length > 0 && "border-t",
            )}
          >
            {matches.length === 0 ? (
              <p className="px-2 py-2 text-[11px] text-muted-fg">{t("tasks.mention_empty")}</p>
            ) : matches.map((a) => (
              <button
                key={a.slug}
                type="button"
                data-testid={`task-mention-${a.slug}`}
                onClick={() => complete(a.slug!)}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-accent/60 active:bg-accent"
              >
                <AgentAvatar {...a} size={20} />
                <span className="min-w-0 flex-1 truncate text-xs font-medium">{a.name}</span>
                <span className="shrink-0 font-mono text-[10px] text-muted-fg">
                  @{a.slug}
                  {a.slug === SUPER_AGENT_SLUG ? ` · ${t("agents_ui.super_agent_badge")}` : ""}
                </span>
              </button>
            ))}
          </div>
        )}

        <div className={cn("flex items-end gap-2 p-2", (comments.length > 0 || picking) && "border-t border-border")}>
          <Textarea
            ref={box}
            rows={2}
            value={text}
            data-testid="task-comment-input"
            placeholder={t("tasks.comment_ph")}
            className="text-xs"
            onChange={(e) => type(e.target.value, e.target.selectionStart ?? e.target.value.length)}
            // The caret can move without the text changing (arrows, a tap), and
            // the picker follows the caret, not the keystroke.
            onSelect={(e) => {
              const el = e.currentTarget;
              setPicking(mentionAt(el.value, el.selectionStart ?? el.value.length));
            }}
            // Enter sends, Shift+Enter breaks the line — the same contract as
            // every other composer in the panel. With the picker open Enter
            // takes the first match instead, which is what every @ box does.
            onKeyDown={(e) => {
              if (e.key === "Escape" && picking) { e.preventDefault(); setPicking(null); return; }
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (picking && matches.length) complete(matches[0].slug!);
                else void send();
              }
            }}
          />
          <Button
            size="sm"
            variant="secondary"
            aria-label={t("tasks.mention_insert")}
            data-testid="task-comment-mention"
            onClick={openPicker}
          >
            <AtSign size={13} />
          </Button>
          <Button
            size="sm"
            variant="primary"
            loading={busy}
            disabled={!text.trim()}
            data-testid="task-comment-send"
            onClick={send}
          >
            <Send size={13} />
          </Button>
        </div>
      </div>
      <div className="text-[10px] text-muted-fg">{t("tasks.comment_hint")}</div>
    </div>
  );
}
