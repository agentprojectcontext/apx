import type { ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "../../lib/cn";
import type { ActiveTurn } from "../../types/daemon";
import { useChatActivity } from "../../hooks/useChatActivity";
import { t } from "../../i18n";

/** One mark. Its width animates from zero, so a row reflows rather than jumps
 *  when the thing it stands for starts or stops. */
function Mark({ on, children }: { on: boolean; children: ReactNode }) {
  return (
    <span
      className={cn(
        "inline-grid h-3 shrink-0 place-items-center overflow-hidden transition-[width,margin,opacity] duration-200 ease-out motion-reduce:transition-none",
        on ? "ml-1.5 w-3 opacity-100" : "ml-0 w-0 opacity-0",
      )}
    >
      <span
        className={cn(
          "grid size-3 place-items-center transition-transform duration-150 ease-out motion-reduce:transition-none",
          on ? "scale-100" : "scale-75",
        )}
      >
        {children}
      </span>
    </span>
  );
}

/**
 * Status marks for a conversation row: a spinner while a turn is being written,
 * a second one while work left running elsewhere is still out, and a blue dot
 * for something unread. They are three different facts, so they stand SIDE BY
 * SIDE — a row where an agent is answering and a background job is still out
 * says both, instead of the louder one hiding the other.
 */
export function ChatRowActivity({
  activityKey,
  activeTurn,
  unread,
  jobRunning,
  className,
}: {
  activityKey: string | null;
  activeTurn?: ActiveTurn | null;
  /** "There is something here I have not read", worked out from the row itself
   *  (lib/chat-read) rather than from a turn this device watched end. A routine
   *  or a task speaking is exactly the case the live registry cannot see. */
  unread?: boolean;
  /** An agent left work running from this thread. NOT the same fact as a live
   *  turn: nobody is writing right now, somebody is WAITING — and from the list
   *  a thread with a peer ten minutes into a job looked exactly like a thread
   *  where nothing had happened since yesterday. */
  jobRunning?: boolean;
  className?: string;
}) {
  const activity = useChatActivity(activityKey, activeTurn);
  const running = activity.running;
  const job = !!jobRunning;
  const isUnread = !!(activity.unread || unread);
  const said = [
    running && t("chat_ui.running_elsewhere"),
    job && t("chat_ui.jobs_running_one"),
    isUnread && t("chat_ui.unread_reply"),
  ].filter(Boolean) as string[];

  return (
    <span
      role={said.length ? "status" : undefined}
      aria-label={said.length ? said.join(" · ") : undefined}
      className={cn("inline-flex shrink-0 items-center", className)}
    >
      {/* The blue the tool rows spin in: the mark and the work it stands for
          read as the same thing. */}
      <Mark on={running}>
        <Loader2 className="size-3 animate-spin text-sky-700 dark:text-sky-400" />
      </Mark>
      {/* Emerald, not sky: the same green the background-jobs panel and the
          context strip already use for left-running work, so the mark on the
          row and the panel that explains it read as one thing. */}
      <Mark on={job}>
        <Loader2 className="size-3 animate-spin text-emerald-700 dark:text-emerald-400" />
      </Mark>
      <Mark on={isUnread}>
        <span className="size-2 rounded-full bg-blue-500" />
      </Mark>
    </span>
  );
}
