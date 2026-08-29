import { cn } from "../../lib/cn";
import { channelLabel } from "../../lib/channels";
import { t } from "../../i18n";

/**
 * One chip per channel, each a switch rather than a choice.
 *
 * The inbox shows every place a conversation can happen, which is right — a
 * WhatsApp thread that only exists on the phone is exactly what used to be
 * invisible. It is also more than anyone wants to read at once: the phone has
 * Telegram installed ON it, so those threads are one home-screen icon away and
 * listing them again is duplication.
 *
 * So this is multi-select, not `<FilterChips>`: turning WhatsApp off has
 * nothing to do with whether Telegram is on. The count rides on the chip
 * because a channel with nothing in it is worth telling apart from one you
 * muted. Choices are per device (see lib/channels.ts).
 */
export function ChannelChips({
  channels,
  counts,
  enabled,
  onToggle,
  className,
  testIdPrefix = "channel-chip",
}: {
  channels: string[];
  counts?: Record<string, number>;
  enabled: (channel: string) => boolean;
  onToggle: (channel: string) => void;
  className?: string;
  testIdPrefix?: string;
}) {
  if (channels.length < 2) return null; // nothing to choose between
  return (
    <div
      className={cn("no-scrollbar flex items-center gap-1 overflow-x-auto", className)}
      role="group"
      aria-label={t("channels.filter")}
    >
      {channels.map((channel) => {
        const on = enabled(channel);
        return (
          <button
            key={channel}
            type="button"
            data-testid={`${testIdPrefix}-${channel}`}
            aria-pressed={on}
            onClick={() => onToggle(channel)}
            className={cn(
              "shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors",
              on
                ? "border-transparent bg-accent text-accent-fg"
                // Off is dimmed, never hidden: the way back is the same chip.
                : "border-border text-muted-fg opacity-70 hover:opacity-100",
            )}
          >
            {channelLabel(channel)}
            {counts?.[channel] ? (
              <span className="ml-1 opacity-60">{counts[channel]}</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

/** The channel a row happened on, as a tag on the row itself.
 *
 *  The list is grouped by channel on the desktop rail, where a sticky heading
 *  can carry it. The phone drills into one flat list, so the same fact has to
 *  travel with the row — otherwise a WhatsApp from a contact and a web chat
 *  with the same agent are two identical-looking lines. */
export function ChannelTag({ channel, className }: { channel: string | null; className?: string }) {
  if (!channel) return null;
  return (
    <span
      data-testid={`channel-tag-${channel}`}
      className={cn(
        "shrink-0 rounded bg-muted px-1.5 py-px text-[10px] font-medium text-muted-fg",
        className,
      )}
    >
      {channelLabel(channel)}
    </span>
  );
}
