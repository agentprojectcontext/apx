import type { InboxRow } from "../../lib/api/inbox";
import { cn } from "../../lib/cn";
import { t } from "../../i18n";
import { ChannelTag } from "./ChannelFilter";
import { ChatRowActivity } from "../chat/ChatRowActivity";
import {
  activityKeyFromActiveTurn,
  conversationActivityKey,
  threadActivityKey,
} from "../../lib/chat-activity";
import { toneChip } from "../../lib/tone";
import { AgentAvatar, AgentAvatarGroup, SUPER_AGENT_ICON } from "../agents/AgentAvatar";

export type InboxRowVariant = "compact" | "touch";

/** Today → time of day; older → date. Same idea as a messaging app. */
export function inboxRowTime(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const sameDay = new Date().toDateString() === d.toDateString();
  return sameDay
    ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

function participantFaces(row: InboxRow) {
  return row.participant_faces?.length
    ? row.participant_faces
    : (row.participants || []).map((slug) => ({ name: slug }));
}

/**
 * Shared conversation row for the desktop rail and the phone inbox.
 * The variant changes density only; identity and information hierarchy stay
 * identical so an a2a thread cannot lose a participant on one surface.
 */
export function InboxRowItem({
  row,
  selected = false,
  variant = "compact",
  onSelect,
}: {
  row: InboxRow;
  selected?: boolean;
  variant?: InboxRowVariant;
  onSelect: (row: InboxRow) => void;
}) {
  const touch = variant === "touch";
  const label = row.agent_name || row.agent_slug;
  const faces = participantFaces(row);
  const grouped = (row.kind === "a2a" || row.kind === "group") && faces.length > 0;
  const activityKey = activityKeyFromActiveTurn(row.active_turn) || (
    row.kind === "agent" && row.project_id != null && row.conversation_id
      ? conversationActivityKey(row.project_id, row.conversation_id)
      : row.kind === "super_agent" && row.project_id != null && row.channel && row.conversation_id
        ? threadActivityKey(row.project_id, row.channel, row.conversation_id)
        : null
  );

  return (
    <button
      type="button"
      data-testid={`inbox-row-${row.agent_slug}`}
      onClick={() => onSelect(row)}
      className={cn(
        "relative flex w-full items-start text-left transition-colors",
        touch
          ? "gap-3 rounded-none px-4 py-3 active:bg-accent/60"
          : "gap-2.5 rounded-lg px-2.5 py-2",
        selected
          ? "bg-primary/12 ring-1 ring-inset ring-primary/25"
          : !touch && "hover:bg-accent/60",
      )}
    >
      <span
        data-testid="inbox-avatar-viewport"
        className={cn(
          "shrink-0 overflow-visible pt-0.5",
          // Grouped rows fan up to three faces plus a "+N" chip, so they need
          // more room than a single avatar before the name column starts.
          touch && (grouped ? "w-[84px]" : "w-12"),
        )}
      >
        {grouped ? (
          <AgentAvatarGroup
            faces={faces}
            size={touch ? 34 : 24}
            max={3}
            data-testid="a2a-avatar-group"
          />
        ) : (
          <AgentAvatar
            icon={row.kind === "super_agent" ? row.agent_icon || SUPER_AGENT_ICON : row.agent_icon}
            emoji={row.agent_emoji}
            name={label}
            size={touch ? 48 : 32}
          />
        )}
      </span>

      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span className={cn("truncate font-medium", touch ? "text-[15px] font-semibold" : "text-sm")}>
            {label}
          </span>
          <span className="ml-auto inline-flex shrink-0 items-center">
            {row.kind === "super_agent" ? (
              <span className={cn("rounded px-1 text-[9px] font-semibold uppercase tracking-wide", toneChip.emerald)}>
                {t("agents_ui.super_agent_badge")}
              </span>
            ) : null}
            <ChatRowActivity activityKey={activityKey} activeTurn={row.active_turn} />
            <span className={cn("ml-2 text-muted-fg", touch ? "text-[11px]" : "text-[10px]")}>
              {inboxRowTime(row.last_activity_at)}
            </span>
          </span>
        </span>

        <span className={cn("mt-0.5 flex items-center gap-1.5 text-muted-fg", touch ? "text-[11px]" : "text-[10px]")}>
          {row.project_name ? <span className="truncate">{row.project_name}</span> : null}
          {/* Where this conversation happened, as a tag on the row. On every
              surface: both lists are now flat and sorted by recency, so this is
              the only thing telling a WhatsApp from a contact apart from a web
              chat with the same agent — otherwise two identical lines. */}
          <ChannelTag channel={row.channel} />
          {row.requested_by ? (
            <span className="shrink-0 rounded bg-primary/12 px-1 text-primary">
              for {row.requested_by}
            </span>
          ) : null}
        </span>

        <span className={cn("mt-0.5 block truncate text-muted-fg", touch ? "text-[13px]" : "text-xs")}>
          {row.preview || t("inbox.no_reply_yet")}
        </span>
      </span>
    </button>
  );
}
