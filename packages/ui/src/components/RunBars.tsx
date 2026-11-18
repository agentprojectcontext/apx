import { cx } from "../cx";
import { Tooltip } from "./Tooltip";

export type RunBarState = "ran" | "cut" | "failed" | "live";
export interface RunBar {
  state: RunBarState;
  /** When it ran and how it went, read on hover and by screen readers. */
  label: string;
  /** Kept stable across refreshes (an event id). */
  id: string;
}

export interface RunBarsProps {
  /** Oldest first, so the newest is at the right. */
  runs: RunBar[];
  /** Accessible name of the row. */
  label: string;
  size?: "sm" | "lg";
  /** The bar that is open; with `onSelect` each bar is a button. */
  selected?: string;
  onSelect?(id: string): void;
  className?: string;
}

/** Recent runs of an automation as a row of bars: full when it ran, short when it stopped early, red when it failed. */
export function RunBars({ runs, label, size = "sm", selected, onSelect, className }: RunBarsProps) {
  const cls = cx("apx-runbars", `apx-runbars--${size}`, className);
  if (!onSelect)
    return (
      <span className={cls} role="img" aria-label={label}>
        {runs.map((r) => (
          <Tooltip key={r.id} content={r.label}>
            <span className={cx("apx-runbars__bar", `apx-runbars__bar--${r.state}`)} />
          </Tooltip>
        ))}
      </span>
    );
  return (
    <fieldset className={cls} aria-label={label}>
      {runs.map((r) => (
        <Tooltip key={r.id} content={r.label}>
          <button
            type="button"
            className={cx("apx-runbars__bar", `apx-runbars__bar--${r.state}`, selected === r.id && "is-selected")}
            aria-label={r.label}
            aria-pressed={selected === r.id}
            onClick={() => onSelect(r.id)}
          />
        </Tooltip>
      ))}
    </fieldset>
  );
}
