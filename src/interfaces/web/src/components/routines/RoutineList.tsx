import { Zap } from "lucide-react";
import type { RoutineEntry } from "../../lib/api";
import { StatusDot } from "../Section";
import { cn } from "../../lib/cn";
import { t } from "../../i18n";
import { kindMeta, scheduleHuman } from "./shared";

// Left column: scrollable list of routines. Click selects (the divider is the
// single border-r line); the detail lives in the sibling column.
export function RoutineList({
  routines, selectedName, onSelect,
}: {
  routines: RoutineEntry[];
  selectedName: string | null;
  onSelect: (name: string) => void;
}) {
  return (
    <aside className="flex h-full min-h-0 flex-col border-r border-border">
      <div className="shrink-0 px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted-fg">
        {t("project.routines.list_title")}
      </div>
      <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto p-2 pt-0">
        {routines.map((r) => {
          const meta = kindMeta()[r.kind];
          const Icon = meta?.icon || Zap;
          const active = r.name === selectedName;
          return (
            <li key={r.name}>
              <button
                type="button"
                onClick={() => onSelect(r.name)}
                aria-current={active}
                className={cn(
                  "w-full rounded-lg border px-2.5 py-2 text-left transition-colors",
                  active
                    ? "border-primary/50 bg-primary/10"
                    : "border-transparent hover:border-border hover:bg-accent/40",
                )}
              >
                <div className="flex items-center gap-2">
                  <span className={cn("flex size-6 shrink-0 items-center justify-center rounded-md", r.enabled ? "bg-emerald-500/15 text-emerald-400" : "bg-muted text-muted-fg")}>
                    <Icon size={13} />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{r.name}</span>
                  {!r.enabled && <span className="shrink-0 text-[10px] text-muted-fg">{t("project.routines.paused")}</span>}
                  <StatusDot ok={r.last_status === "ok" ? true : r.last_status === "error" ? false : null} />
                </div>
                <div className="mt-1 flex items-center justify-between gap-2 pl-8 text-[10px] text-muted-fg">
                  <span className="truncate">{meta?.label || r.kind}</span>
                  <span className="shrink-0">⏱ {scheduleHuman(r.schedule)}</span>
                </div>
              </button>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
