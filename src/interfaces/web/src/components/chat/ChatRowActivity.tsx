import { LoaderCircle } from "lucide-react";
import { cn } from "../../lib/cn";
import type { ActiveTurn } from "../../types/daemon";
import { useChatActivity } from "../../hooks/useChatActivity";
import { t } from "../../i18n";

/** One compact status mark for every chat rail: spinner while work is live,
 * blue dot after it finishes out of view. Its width animates from zero, so the
 * adjacent badge shifts rather than jumping when activity changes. */
export function ChatRowActivity({
  activityKey,
  activeTurn,
}: {
  activityKey: string | null;
  activeTurn?: ActiveTurn | null;
}) {
  const activity = useChatActivity(activityKey, activeTurn);
  const status = activity.running ? "running" : activity.unread ? "unread" : null;

  return (
    <span
      role={status ? "status" : undefined}
      aria-label={status === "running" ? t("chat_ui.running_elsewhere") : status === "unread" ? t("chat_ui.unread_reply") : undefined}
      className={cn(
        "relative inline-grid h-2.5 shrink-0 overflow-hidden align-[-1px] transition-[width,margin,opacity] duration-200 ease-out motion-reduce:transition-none",
        status ? "ml-1 w-2.5 opacity-100" : "ml-0 w-0 opacity-0",
      )}
    >
      <span
        className={cn(
          "absolute inset-0 grid place-items-center rounded-full bg-black/65 text-white ring-1 ring-white/15 transition-[opacity,transform] duration-150 ease-out motion-reduce:transition-none",
          status === "running" ? "scale-100 opacity-100" : "scale-75 opacity-0",
        )}
      >
        <LoaderCircle className="size-2 animate-spin" />
      </span>
      <span
        className={cn(
          "absolute inset-0 rounded-full bg-blue-500 ring-1 ring-card transition-[opacity,transform] duration-150 ease-out motion-reduce:transition-none",
          status === "unread" ? "scale-100 opacity-100" : "scale-75 opacity-0",
        )}
      />
    </span>
  );
}
