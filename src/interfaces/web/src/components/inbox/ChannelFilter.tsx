import { ListFilter, Check } from "lucide-react";
import { cn } from "../../lib/cn";
import { channelLabel } from "../../lib/channels";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuCheckboxItem, DropdownMenuItem, DropdownMenuSeparator,
} from "../ui/dropdown-menu";
import { t } from "../../i18n";

/**
 * Which channels this device wants to see — as a picker, not a strip.
 *
 * It shipped as a row of chips, one per channel, and on a real install that is
 * eleven of them: the row ran off the edge of both the inbox rail (288px) and
 * the phone, so the filters were there and could not be found. A strip only
 * works when the whole set fits, and this set grows with every surface APX
 * learns to speak on.
 *
 * So: one small trigger that says how many are on out of how many exist, and
 * a menu of switches behind it. `closeOnClick` is false on a checkbox item in
 * Base UI, which is what makes this a multi-select — tick three, see the list
 * change under the open menu, then dismiss.
 *
 * The count on the trigger is the whole point of the control being collapsed:
 * "6 of 11" says a filter is on without opening anything, which a chip row
 * only says if you can see all of it.
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
  if (channels.length < 2) return null; // nothing to choose between
  const on = channels.filter(enabled).length;
  const all = on === channels.length;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        data-testid={`${testIdPrefix}-filter`}
        aria-label={t("channels.filter")}
        className={cn(
          "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors",
          // A filter that is DOING something looks different from one that is
          // not: all-on is the resting state, anything else is a live filter.
          all
            ? "border-border text-muted-fg hover:bg-muted/50 hover:text-foreground"
            : "border-primary/40 bg-primary/10 text-primary",
          "data-[popup-open]:bg-muted data-[popup-open]:text-foreground",
          className,
        )}
      >
        <ListFilter className="size-3.5" />
        {t("channels.filter")}
        <span className={cn("tabular-nums", all && "opacity-60")}>
          {all ? t("channels.all") : t("channels.n_of_m", { n: on, total: channels.length })}
        </span>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" sideOffset={6} className="max-h-80 w-56 overflow-y-auto">
        {channels.map((channel) => (
          <DropdownMenuCheckboxItem
            key={channel}
            data-testid={`${testIdPrefix}-option-${channel}`}
            checked={enabled(channel)}
            onCheckedChange={() => onToggle(channel)}
          >
            <span className="truncate">{channelLabel(channel)}</span>
            {counts?.[channel] ? (
              <span className="ml-auto pr-4 text-xs tabular-nums text-muted-fg">{counts[channel]}</span>
            ) : null}
          </DropdownMenuCheckboxItem>
        ))}

        {onSetAll && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              data-testid={`${testIdPrefix}-all`}
              closeOnClick={false}
              onClick={() => onSetAll(!all)}
            >
              <Check className="size-3.5 opacity-60" />
              {all ? t("channels.none") : t("channels.select_all")}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
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
