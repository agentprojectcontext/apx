import { cn } from "../../lib/cn";

/**
 * One row of mutually-exclusive filters.
 *
 * Exists so every list page filters the same way and reads the same way.
 * Labels are Capitalised: the chips used to render whatever the state value
 * happened to be ("open", "in review"), which put raw storage vocabulary in
 * the interface.
 */
export function FilterChips<T extends string>({
  value,
  options,
  onChange,
  label,
  testIdPrefix,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  label?: string;
  /** Stamps `<prefix>-<value>` on each chip, for e2e. */
  testIdPrefix?: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1" role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          data-testid={testIdPrefix ? `${testIdPrefix}-${o.value}` : undefined}
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
            value === o.value
              ? "bg-accent text-accent-fg"
              : "text-muted-fg hover:bg-muted/50 hover:text-foreground",
          )}
        >
          {capitalise(o.label)}
        </button>
      ))}
    </div>
  );
}

/** First letter up, rest untouched — so "in review" keeps its lowercase w. */
function capitalise(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}
