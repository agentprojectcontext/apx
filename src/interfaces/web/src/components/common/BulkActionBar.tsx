import type { ReactNode } from "react";
import { X } from "lucide-react";
import { Button } from "../ui";

export type BulkAction = {
  key: string;
  label: string;
  icon: ReactNode;
  variant?: "primary" | "secondary" | "destructive" | "ghost";
  onClick: () => void;
  testId?: string;
};

/**
 * Floating bar that rises from the bottom while a multi-select is running.
 * Shared by every list screen — it only renders the count, the verbs it is
 * handed, and a way out. It never mutates on its own: each verb opens a confirm
 * dialog upstream.
 */
export function BulkActionBar({
  count,
  countLabel,
  actions,
  onClear,
  clearLabel,
  testId = "bulk-bar",
}: {
  count: number;
  /** Already-interpolated "N selected" — the caller owns the noun's gender. */
  countLabel: string;
  actions: BulkAction[];
  onClear: () => void;
  clearLabel: string;
  testId?: string;
}) {
  if (count === 0) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-40 flex justify-center px-4">
      <div
        role="toolbar"
        aria-label={countLabel}
        data-testid={testId}
        className="pointer-events-auto flex items-center gap-2 rounded-full border border-border bg-popover/95 py-2 pl-4 pr-2 shadow-lg backdrop-blur"
      >
        <span className="text-sm font-medium tabular-nums" data-testid={`${testId}-count`}>
          {countLabel}
        </span>
        <span className="mx-1 h-5 w-px bg-border" />
        {actions.map((a) => (
          <Button key={a.key} size="sm" variant={a.variant ?? "secondary"} data-testid={a.testId} onClick={a.onClick}>
            {a.icon} {a.label}
          </Button>
        ))}
        <Button size="sm" variant="ghost" aria-label={clearLabel} data-testid={`${testId}-clear`} onClick={onClear}>
          <X size={14} />
        </Button>
      </div>
    </div>
  );
}
