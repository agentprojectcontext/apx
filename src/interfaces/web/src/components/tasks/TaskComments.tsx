import { useEffect, useRef, useState } from "react";
import useSWR from "swr";
import { Send } from "lucide-react";
import { Tasks } from "../../lib/api";
import { Agents } from "../../lib/api/agents";
import { Button, Textarea } from "../ui";
import { AgentAvatar } from "../agents/AgentAvatar";
import { useToast } from "../Toast";
import { relativeWhen } from "../../lib/when";
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
 * stored and we poll for the replies (see `waitForReplies`).
 */
const THREAD_MAX_H = "max-h-72";

/** How long to keep watching for a summoned agent's reply, and how often. */
const POLL_MS = 4000;
const POLL_FOR_MS = 3 * 60 * 1000;

function authorName(by: string | null, faces: Map<string, AgentFace>) {
  if (!by || by === "owner") return t("tasks.comment_owner");
  return faces.get(by)?.name || by;
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
  const scroller = useRef<HTMLDivElement | null>(null);
  const polling = useRef<ReturnType<typeof setInterval> | null>(null);

  // One request for the roster, shared with every other screen on this project.
  // It is what lets a comment wear the agent's real face instead of an initial.
  const { data: agents } = useSWR(pid ? `/api/projects/${pid}/agents` : null, () => Agents.list(pid));
  const faces = new Map<string, AgentFace>(
    (agents ?? []).map((a) => [a.slug, { slug: a.slug, icon: a.icon, emoji: a.emoji, name: a.name || a.slug }]),
  );

  // Newest comment in view. A thread you have to scroll to see the reply you
  // just triggered is a thread that looks broken.
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [comments.length]);

  // Stop polling when the pane closes or the task changes — an interval that
  // outlives its component keeps re-fetching a task nobody is looking at.
  useEffect(() => () => { if (polling.current) clearInterval(polling.current); }, [taskId]);

  /**
   * Watch for the summoned agents' replies. There is no push channel for a
   * task, and the alternative (awaiting the run inside the POST) times out on
   * the phone and gets retried into a second, duplicate run.
   */
  const waitForReplies = () => {
    if (polling.current) clearInterval(polling.current);
    const started = Date.now();
    polling.current = setInterval(() => {
      if (Date.now() - started > POLL_FOR_MS) {
        if (polling.current) clearInterval(polling.current);
        polling.current = null;
        return;
      }
      onChanged();
    }, POLL_MS);
  };

  const send = async () => {
    const body = text.trim();
    if (!body || busy) return;
    setBusy(true);
    try {
      const { summoned } = await Tasks.comment(pid, taskId, body);
      setText("");
      onChanged();
      if (summoned?.length) {
        toast.info(t("tasks.comment_summoned", { who: summoned.map((s) => `@${s}`).join(", ") }));
        waitForReplies();
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

        <div className={cn("flex items-end gap-2 p-2", comments.length > 0 && "border-t border-border")}>
          <Textarea
            rows={2}
            value={text}
            data-testid="task-comment-input"
            placeholder={t("tasks.comment_ph")}
            className="text-xs"
            onChange={(e) => setText(e.target.value)}
            // Enter sends, Shift+Enter breaks the line — the same contract as
            // every other composer in the panel.
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); }
            }}
          />
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
