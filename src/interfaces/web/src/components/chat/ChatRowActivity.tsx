import { Loader2 } from "lucide-react";
import { cn } from "../../lib/cn";
import type { ActiveTurn } from "../../types/daemon";
import { useChatActivity } from "../../hooks/useChatActivity";
import { t } from "../../i18n";

/** One compact status mark for every chat rail: spinner while work is live,
 * blue dot after it finishes out of view. It rides at the end of the row's
 * last line, right after the text it belongs to, and its width animates from
 * zero, so the line reflows rather than jumping when activity changes. */
export function ChatRowActivity({
  activityKey,
  activeTurn,
  unread,
}: {
  activityKey: string | null;
  activeTurn?: ActiveTurn | null;
  /** "There is something here I have not read", worked out from the row itself
   *  (lib/chat-read) rather than from a turn this device watched end. A routine
   *  or a task speaking is exactly the case the live registry cannot see. */
  unread?: boolean;
}) {
  const activity = useChatActivity(activityKey, activeTurn);
  const status = activity.running ? "running" : activity.unread || unread ? "unread" : null;

  return (
    <span
      role={status ? "status" : undefined}
      aria-label={status === "running" ? t("chat_ui.running_elsewhere") : status === "unread" ? t("chat_ui.unread_reply") : undefined}
      className={cn(
        "relative inline-grid h-3 shrink-0 place-items-center overflow-hidden transition-[width,margin,opacity] duration-200 ease-out motion-reduce:transition-none",
        status ? "ml-1.5 w-3 opacity-100" : "ml-0 w-0 opacity-0",
      )}
    >
      {/* The blue the tool rows spin in: the mark and the work it stands for
          read as the same thing. The old dark disc with a white hairline
          inside it was barely visible against the row. */}
      <Loader2
        className={cn(
          "col-start-1 row-start-1 size-3 animate-spin text-sky-700 transition-[opacity,transform] duration-150 ease-out dark:text-sky-400 motion-reduce:transition-none",
          status === "running" ? "scale-100 opacity-100" : "scale-75 opacity-0",
        )}
      />
      <span
        className={cn(
          "col-start-1 row-start-1 size-2 rounded-full bg-blue-500 transition-[opacity,transform] duration-150 ease-out motion-reduce:transition-none",
          status === "unread" ? "scale-100 opacity-100" : "scale-75 opacity-0",
        )}
      />
    </span>
  );
}
