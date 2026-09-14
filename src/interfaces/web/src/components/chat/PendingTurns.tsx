import { Clock, X, Zap } from "lucide-react";
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
 */
export function PendingTurns({
  queued,
  onUnqueue,
  docked = false,
}: {
  queued: QueuedTurn[];
  onUnqueue?: (id: string) => void;
  /** Sit inside the composer card as part of its top edge, the way the context
   *  strip does, instead of floating above it as a second box. */
  docked?: boolean;
}) {
  if (!queued.length) return null;

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
      {queued.map((q) => {
        const cutsIn = q.interrupting;
        return (
          <div key={q.id} className="flex items-start gap-2">
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
            {onUnqueue && (
              <Tip content={t("chat_ui.queued_cancel")}>
                <button
                  type="button"
                  onClick={() => onUnqueue(q.id)}
                  data-testid={`unqueue-${q.id}`}
                  aria-label={t("chat_ui.queued_cancel")}
                  className="mt-0.5 shrink-0 rounded p-0.5 text-muted-fg hover:bg-destructive/10 hover:text-destructive"
                >
                  <X size={12} />
                </button>
              </Tip>
            )}
          </div>
        );
      })}
    </div>
  );
}
