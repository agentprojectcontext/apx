import type { InboxRow } from "../../lib/api/inbox";
import { cn } from "../../lib/cn";
import { t } from "../../i18n";
import { ChannelTag } from "./ChannelFilter";
import { ProjectTag } from "./ProjectFilter";
import { ChatRowActivity } from "../chat/ChatRowActivity";
import {
  activityKeyFromActiveTurn,
  conversationActivityKey,
  threadActivityKey,
} from "../../lib/chat-activity";
import { toneChip } from "../../lib/tone";
import { useChatActivity } from "../../hooks/useChatActivity";
import { useRowUnread } from "../../hooks/useChatRead";
import { useThreadJobRunning } from "../../hooks/useBackgroundJobs";
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

/** Channels where a message from "the user" is not necessarily the OWNER's.
 *  Other people write in on these — a WhatsApp contact, a Telegram guest off
 *  the roster — and the ledger records them under the same role, so marking one
 *  of their lines "Vos:" would be a lie about who said it. The row is titled
 *  with their name there anyway. Everywhere else the user IS the owner. */
const SHARED_CHANNELS = new Set(["whatsapp", "telegram"]);

/** How much of a live answer reaches the DOM. Several times what a row can
 *  show, so the clip has room to work, and nothing like the whole answer: this
 *  is rewritten on every token. */
const LIVE_TAIL = 120;

/**
 * The END of what is being written, not the beginning of it.
 *
 * A row is one clipped line. Showing the head of a streaming answer means the
 * first six words appear and then nothing ever moves again — the exact opposite
 * of what a live line is for. The tail reads the way the words arrive; the clip
 * is flipped to the left in the render, which is what draws the leading "…".
 */
function liveTail(text?: string): string {
  return String(text || "").replace(/\s+/g, " ").trim().slice(-LIVE_TAIL);
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
  const unread = useRowUnread(row);
  // A job's `thread` IS the a2a pair id this row is keyed by, so the row can
  // answer "somebody left work running here" without a second lookup. It could
  // always answer it and never did: from the list, a peer ten minutes into a
  // job and a thread nothing had touched since yesterday were the same row.
  const jobRunning = useThreadJobRunning(row.kind === "a2a" ? row.conversation_id : null);
  // On a channel with several correspondents the row is the PERSON's; the
  // daemon resolved their name and face, so nothing is re-derived here.
  const contactFace = row.contact_face;
  const label = contactFace?.name || row.agent_name || row.agent_slug;
  const faces = participantFaces(row);
  const grouped = (row.kind === "a2a" || row.kind === "group") && faces.length > 0;
  const activityKey = activityKeyFromActiveTurn(row.active_turn) || (
    row.kind === "agent" && row.project_id != null && row.conversation_id
      ? conversationActivityKey(row.project_id, row.conversation_id)
      : row.kind === "super_agent" && row.project_id != null && row.channel && row.conversation_id
        ? threadActivityKey(row.project_id, row.channel, row.conversation_id)
        : null
  );
  // The same registry the spinner reads, for the thing the spinner cannot say:
  // WHAT is being written. While a turn runs the row follows its text — and
  // only its text; the tools it is running are work, not a line anyone reads
  // off a list.
  const activity = useChatActivity(activityKey, row.active_turn);
  const live = activity.running ? liveTail(activity.text) : "";
  // What the row prints when nothing is being written: the last thing said,
  // falling back — for the multi-agent rows, whose preview already names its
  // own author — to the agent's last reply.
  const said = row.last_message || row.preview || "";
  // "Vos:", the way every chat list marks your own half of a conversation.
  // Only where the user IS the owner: on a channel that carries other people
  // (WhatsApp) the user role is THEIRS, and the row already wears their name.
  const ownVoice = !live
    && row.last_role === "user"
    && !row.contact
    && !SHARED_CHANNELS.has(row.channel || "");

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
            icon={
              contactFace
                ? contactFace.icon
                : row.kind === "super_agent"
                  ? row.agent_icon || SUPER_AGENT_ICON
                  : row.agent_icon
            }
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
            <span className={cn("ml-2 text-muted-fg", touch ? "text-[11px]" : "text-[10px]")}>
              {inboxRowTime(row.last_activity_at)}
            </span>
          </span>
        </span>

        <span
          data-testid="inbox-row-meta"
          className={cn("mt-0.5 flex items-center gap-1.5 text-muted-fg", touch ? "text-[11px]" : "text-[10px]")}
        >
          {/* Two facts, two badges, never one slot: where this agent comes
              FROM and where the conversation HAPPENED. The project used to be
              bare text next to the channel's tag, which read as a caption on
              it; and it printed for the default workspace too, labelling most
              of the list with the one place that goes without saying. */}
          <ProjectTag projectId={row.project_id} name={row.project_name} />
          {/* On every surface: both lists are now flat and sorted by recency,
              so this is the only thing telling a WhatsApp from a contact apart
              from a web chat with the same agent — otherwise two identical
              lines. */}
          <ChannelTag channel={row.channel} />
          {row.requested_by ? (
            <span className="shrink-0 rounded bg-primary/12 px-1 text-primary">
              for {row.requested_by}
            </span>
          ) : null}
          {/* The marks ride at the END of this line — the one with room to
              spare — and not on the message line, which is the one that wants
              every pixel. Nothing is hidden by anything else there: a live
              turn, work left running and something unread are three separate
              facts and they stand side by side. */}
          <ChatRowActivity
            className="ml-auto"
            activityKey={activityKey}
            activeTurn={row.active_turn}
            unread={unread}
            jobRunning={jobRunning}
          />
        </span>

        {/* The last line said, with the whole row to itself: one line, and the
            whole width of it. The marks that used to share it — and shorten it
            — moved up to the tag line, so what gets clipped here is clipped by
            the width of the rail and by nothing else. */}
        <span className={cn("mt-0.5 flex items-center text-muted-fg", touch ? "text-[13px]" : "text-xs")}>
          <span
            className="min-w-0 flex-1 truncate"
            data-testid="inbox-row-preview"
            // While the answer streams, the line is clipped at its START — the
            // newest words are the ones worth the width, and an ellipsis on the
            // right would hide exactly the half that is moving. An RTL box is
            // what moves the clip (and its ellipsis) to the left.
            style={live ? { direction: "rtl" } : undefined}
          >
            {live ? (
              // The text keeps its OWN direction inside that box. Without the
              // isolate, a neutral character at either end — the full stop this
              // sentence may be about to end on — is laid out against the box
              // instead, jumps to the far side, and is the first thing clipped.
              <bdi>{live}</bdi>
            ) : said ? (
              ownVoice ? `${t("inbox.you")}: ${said}` : said
            ) : (
              t("inbox.no_messages_yet")
            )}
          </span>
        </span>
      </span>
    </button>
  );
}
