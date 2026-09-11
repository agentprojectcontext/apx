import { cn } from "../../lib/cn";
import { channelLabel } from "../../lib/channels";
import { OptionFilter } from "./OptionFilter";
import { t } from "../../i18n";

/**
 * Which channels this device wants to see — as a picker, not a strip.
 *
 * The layout and the reasoning behind it live in `OptionFilter`, which the
 * project filter beside this one shares: same menu, other question. All that
 * is channel-specific is the vocabulary.
 */
export function ChannelFilter({
  channels,
  counts,
  enabled,
  onToggle,
  onSetAll,
  className,
  testIdPrefix = "channel",
}: {
  channels: string[];
  counts?: Record<string, number>;
  enabled: (channel: string) => boolean;
  onToggle: (channel: string) => void;
  /** Turn every channel on (or off) in one go — the way back from a list you
   *  filtered down to nothing, without eleven taps. */
  onSetAll?: (on: boolean) => void;
  className?: string;
  testIdPrefix?: string;
}) {
  return (
    <OptionFilter
      label={t("channels.filter")}
      options={channels.map((channel) => ({
        value: channel,
        label: channelLabel(channel),
        count: counts?.[channel],
      }))}
      enabled={enabled}
      onToggle={onToggle}
      onSetAll={onSetAll}
      className={className}
      testIdPrefix={testIdPrefix}
    />
  );
}

/**
 * The same switches laid out flat, for a settings panel.
 *
 * Kept apart from the picker above on purpose: a filter next to a list should
 * be out of the way until you want it, while a preference in Settings is worth
 * seeing all of at once — that IS the answer to "what is this device allowed to
 * tell me". Same state, same labels, two places with opposite needs.
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
  if (channels.length < 2) return null;
  return (
    <div className={cn("flex flex-wrap items-center gap-1", className)} role="group" aria-label={t("channels.filter")}>
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
            {counts?.[channel] ? <span className="ml-1 opacity-60">{counts[channel]}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

/** The channel a row happened on, as a tag on the row itself.
 *
 *  Both lists — the desktop rail and /m/chat — are flat and sorted by recency,
 *  so this fact has to travel with the row. Without it a WhatsApp from a
 *  contact and a web chat with the same agent are two identical-looking
 *  lines. */
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
