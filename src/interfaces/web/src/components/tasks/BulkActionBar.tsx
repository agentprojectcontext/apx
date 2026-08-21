import { Check, Trash2, X } from "lucide-react";
import { Button } from "../ui";
import { t } from "../../i18n";

/**
 * Floating bar that rises from the bottom while a multi-select is running.
 * It carries only the two bulk verbs plus a way out — every verb still goes
 * through a confirm dialog upstream, so this bar never mutates on its own.
 */
export function BulkActionBar({
  count,
  onDone,
  onDrop,
  onClear,
}: {
  count: number;
  onDone: () => void;
  onDrop: () => void;
  onClear: () => void;
}) {
  if (count === 0) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-40 flex justify-center px-4">
      <div
        role="toolbar"
        aria-label={t("tasks.bulk_selected", { count })}
        data-testid="task-bulk-bar"
        className="pointer-events-auto flex items-center gap-2 rounded-full border border-border bg-popover/95 py-2 pl-4 pr-2 shadow-lg backdrop-blur"
      >
        <span className="text-sm font-medium tabular-nums" data-testid="task-bulk-count">
          {t("tasks.bulk_selected", { count })}
        </span>
        <span className="mx-1 h-5 w-px bg-border" />
        <Button size="sm" variant="secondary" data-testid="task-bulk-done" onClick={onDone}>
          <Check size={14} /> {t("tasks.bulk_done")}
        </Button>
        <Button size="sm" variant="destructive" data-testid="task-bulk-drop" onClick={onDrop}>
          <Trash2 size={14} /> {t("tasks.bulk_drop")}
        </Button>
        <Button size="sm" variant="ghost" aria-label={t("tasks.bulk_clear")} data-testid="task-bulk-clear" onClick={onClear}>
          <X size={14} />
        </Button>
      </div>
    </div>
  );
}
