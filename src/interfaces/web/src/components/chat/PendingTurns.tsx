import { ArrowDown, ArrowUp, Clock, SendHorizontal, X, Zap } from "lucide-react";
import { Tip } from "../ui/tip";
import { cn } from "../../lib/cn";
import { t } from "../../i18n";
import type { QueuedTurn } from "../../hooks/useChat";

/**
 * What you have written that has NOT gone out yet, welded to the top of the
 * field you wrote it in.
 *
 * WHY IT LEFT THE TRANSCRIPT. These used to be ordinary bubbles at the foot of
 * the conversation, on the reasoning that "what you wrote is in the conversation
 * the moment you send it". Reading it back is what breaks: a parked line drawn
 * exactly like a sent one reads as sent, and the only thing saying otherwise was
 * a small clock on its footer. Scroll up and it is gone from view entirely —
 * still parked, still going to fire, and nowhere you can see it. Manu,
 * 2026-09-14: "es mejor ordenarlo digamos arriba del mismo textarea, como lo
 * hacemos acá en Claude".
 *
 * Above the field it is pinned, it cannot be scrolled away from, and its
 * position says the thing its styling could not: this is still input, not
 * conversation. It joins the transcript when it actually goes out.
 *
 * TWO STATES, and telling them apart is the other half of the report. Both ride
 * the same queue — the drain is what sends either one — so the interface called
 * both "En cola", including the one that had just aborted the running turn and
 * was leaving as soon as that landed. "Puse interrumpe y lo mandó en cola" is
 * what that looks like from outside: you pick the mode that cuts in, and the
 * feedback names the mode you did not pick.
 *
 * AND IT IS A QUEUE YOU CAN WORK. Seeing what is parked only helps if you can
 * act on it: the strip drained strictly in the order you typed, so a correction
 * written after an afterthought went out behind it, and the only way to promote
 * anything was to cancel the rest and retype. Each row carries its own controls
 * — send this one next (cutting the running turn short), or move it a step up or
 * down — so the order it leaves in is the order you decide, not the order you
 * happened to think of things.
 */
export function PendingTurns({
  queued,
  onUnqueue,
  onSendNow,
  onMove,
  docked = false,
}: {
  queued: QueuedTurn[];
  onUnqueue?: (id: string) => void;
  /** Promote to the head of the queue and interrupt whatever is running. */
  onSendNow?: (id: string) => void;
  /** Swap with the neighbour above (-1) or below (1). */
  onMove?: (id: string, direction: -1 | 1) => void;
  /** Sit inside the composer card as part of its top edge, the way the context
   *  strip does, instead of floating above it as a second box. */
  docked?: boolean;
}) {
  if (!queued.length) return null;
  // Reordering one thing is not reordering. The arrows only appear once there
  // is somewhere to move to, so a single parked line keeps the strip as quiet
  // as it was before any of this existed.
  const reorderable = queued.length > 1;

  return (
    <div
      data-testid="pending-turns"
      className={cn(
        "shrink-0 space-y-1 text-[11px]",
        docked
          ? "-mx-2 -mt-2 border-b border-border/70 bg-muted/40 px-4 py-2"
          : "rounded-lg border border-border bg-card/60 px-3 py-2",
      )}
    >
      {queued.map((q, i) => {
        const cutsIn = q.interrupting;
        return (
          <div key={q.id} className="group/pending flex items-start gap-2">
            {/* The state first, because it is the thing you came here to read.
                Cutting in takes the same green the rest of the panel gives to
                work in flight; waiting stays muted, because waiting is not an
                event. */}
            <span
              data-testid={`pending-state-${q.id}`}
              data-pending-kind={cutsIn ? "interrupting" : "queued"}
              className={cn(
                "mt-0.5 inline-flex shrink-0 items-center gap-1 tabular-nums",
                cutsIn ? "text-emerald-700 dark:text-emerald-400" : "text-muted-fg",
              )}
            >
              {cutsIn ? <Zap size={11} /> : <Clock size={11} />}
              {cutsIn ? t("chat_ui.pending_interrupting") : t("chat_ui.queued")}
            </span>
            {/* What you wrote, so the strip is a reminder and not just a status.
                Two lines: enough to recognise the line, not enough to become a
                second transcript above the field. */}
            <p className="line-clamp-2 min-w-0 flex-1 text-foreground">
              {q.msg.parts.find((p) => p.kind === "text")?.text || q.text}
            </p>
            {/* The controls sit in one shrink-0 group so a long line wraps
                against them instead of pushing them off the row. */}
            <div className="mt-0.5 flex shrink-0 items-center gap-0.5">
              {onMove && reorderable && (
                <>
                  <Tip content={t("chat_ui.queued_move_up")}>
                    <button
                      type="button"
                      onClick={() => onMove(q.id, -1)}
                      disabled={i === 0}
                      data-testid={`queued-up-${q.id}`}
                      aria-label={t("chat_ui.queued_move_up")}
                      className="rounded p-0.5 text-muted-fg hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-30"
                    >
                      <ArrowUp size={12} />
                    </button>
                  </Tip>
                  <Tip content={t("chat_ui.queued_move_down")}>
                    <button
                      type="button"
                      onClick={() => onMove(q.id, 1)}
                      disabled={i === queued.length - 1}
                      data-testid={`queued-down-${q.id}`}
                      aria-label={t("chat_ui.queued_move_down")}
                      className="rounded p-0.5 text-muted-fg hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-30"
                    >
                      <ArrowDown size={12} />
                    </button>
                  </Tip>
                </>
              )}
              {/* Green, like everything else in the panel that means work in
                  flight — this is the button that makes a line cut in. Hidden
                  on the one that is already leaving next while cutting in:
                  there is nothing left for it to do. */}
              {onSendNow && !(cutsIn && i === 0) && (
                <Tip content={t("chat_ui.queued_send_now")}>
                  <button
                    type="button"
                    onClick={() => onSendNow(q.id)}
                    data-testid={`send-now-${q.id}`}
                    aria-label={t("chat_ui.queued_send_now")}
                    className="rounded p-0.5 text-muted-fg hover:bg-emerald-500/10 hover:text-emerald-700 dark:hover:text-emerald-400"
                  >
                    <SendHorizontal size={12} />
                  </button>
                </Tip>
              )}
              {onUnqueue && (
                <Tip content={t("chat_ui.queued_cancel")}>
                  <button
                    type="button"
                    onClick={() => onUnqueue(q.id)}
                    data-testid={`unqueue-${q.id}`}
                    aria-label={t("chat_ui.queued_cancel")}
                    className="rounded p-0.5 text-muted-fg hover:bg-destructive/10 hover:text-destructive"
                  >
                    <X size={12} />
                  </button>
                </Tip>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
