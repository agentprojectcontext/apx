import { ListFilter, Check } from "lucide-react";
import { cn } from "../../lib/cn";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuCheckboxItem, DropdownMenuItem, DropdownMenuSeparator,
} from "../ui/dropdown-menu";
import { t } from "../../i18n";

/** One switch in the menu: what it filters, what to call it, how many rows it
 *  currently accounts for. */
export interface FilterOption {
  value: string;
  label: string;
  count?: number;
}

/**
 * A set of switches over a list — as a picker, not a strip.
 *
 * The channel version shipped as a row of chips, one per channel, and on a real
 * install that is eleven of them: the row ran off the edge of both the inbox
 * rail (288px) and the phone, so the filters were there and could not be found.
 * A strip only works when the whole set fits, and none of these sets is fixed —
 * channels grow with every surface APX learns to speak on, projects with every
 * one registered.
 *
 * So: one small trigger that says how many are on out of how many exist, and a
 * menu of switches behind it. `closeOnClick` is false on a checkbox item in
 * Base UI, which is what makes this a multi-select — tick three, see the list
 * change under the open menu, then dismiss.
 *
 * The count on the trigger is the whole point of the control being collapsed:
 * "6 of 11" says a filter is on without opening anything, which a chip row only
 * says if you can see all of it.
 *
 * Generic because the inbox now has two of these side by side, and they differ
 * only in vocabulary: WHERE a conversation happened (the channel) and WHERE it
 * comes from (the project). One layout, two questions — the alternative was
 * this menu written twice and drifting apart on the first change to either.
 */
export function OptionFilter({
  label,
  options,
  enabled,
  onToggle,
  onSetAll,
  className,
  testIdPrefix,
}: {
  /** Names what is being filtered, on the trigger and to a screen reader. */
  label: string;
  options: FilterOption[];
  enabled: (value: string) => boolean;
  onToggle: (value: string) => void;
  /** Turn every option on (or off) in one go — the way back from a list you
   *  filtered down to nothing, without eleven taps. */
  onSetAll?: (on: boolean) => void;
  className?: string;
  testIdPrefix: string;
}) {
  if (options.length < 2) return null; // nothing to choose between
  const on = options.filter((o) => enabled(o.value)).length;
  const all = on === options.length;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        data-testid={`${testIdPrefix}-filter`}
        aria-label={label}
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
        {label}
        <span className={cn("tabular-nums", all && "opacity-60")}>
          {all ? t("filters.all") : t("filters.n_of_m", { n: on, total: options.length })}
        </span>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" sideOffset={6} className="max-h-80 w-56 overflow-y-auto">
        {options.map((option) => (
          <DropdownMenuCheckboxItem
            key={option.value}
            data-testid={`${testIdPrefix}-option-${option.value}`}
            checked={enabled(option.value)}
            onCheckedChange={() => onToggle(option.value)}
          >
            <span className="truncate">{option.label}</span>
            {option.count ? (
              <span className="ml-auto pr-4 text-xs tabular-nums text-muted-fg">{option.count}</span>
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
              {all ? t("filters.none") : t("filters.select_all")}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
