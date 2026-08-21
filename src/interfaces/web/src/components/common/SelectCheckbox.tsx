import { Check } from "lucide-react";
import { cn } from "../../lib/cn";

/**
 * The square multi-select toggle shared by every list screen (tasks,
 * commitments, routines). One component so the look — and the dark-mode border,
 * which is deliberately a notch lighter than a plain divider so an empty box is
 * still findable — stays identical everywhere.
 */
export function SelectCheckbox({
  checked,
  onToggle,
  label,
  testId,
}: {
  checked: boolean;
  onToggle: () => void;
  /** aria-label — the row is not the checkbox, so it needs its own name. */
  label: string;
  testId?: string;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      data-testid={testId}
      onClick={onToggle}
      className={cn(
        "flex size-4 items-center justify-center rounded border transition-colors",
        checked
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border hover:border-primary dark:border-muted-fg/50",
      )}
    >
      {checked && <Check size={12} strokeWidth={3} />}
    </button>
  );
}
