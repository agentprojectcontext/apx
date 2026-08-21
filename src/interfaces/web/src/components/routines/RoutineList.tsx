import { Zap } from "lucide-react";
import type { RoutineEntry } from "../../lib/api";
import { StatusDot } from "../Section";
import { SelectCheckbox } from "../common/SelectCheckbox";
import { cn } from "../../lib/cn";
import { t } from "../../i18n";
import { toneTint } from "../../lib/tone";
import { kindMeta, scheduleHuman } from "./shared";

/** The agent an exec_agent routine runs, when it names one. */
function agentSlug(r: RoutineEntry): string {
  if (r.kind !== "exec_agent") return "";
  return String((r.spec as Record<string, unknown> | undefined)?.agent || "");
}

// Left column: scrollable list of routines. Click selects (the divider is the
// single border-r line); the detail lives in the sibling column.
export function RoutineList({
  routines, selectedName, onSelect, checkedNames, onToggleCheck,
}: {
  routines: RoutineEntry[];
  selectedName: string | null;
  onSelect: (name: string) => void;
  /** Multi-select: routine names ticked for a bulk run (the screen owns it). */
  checkedNames?: Set<string>;
  onToggleCheck?: (r: RoutineEntry) => void;
}) {
  const selecting = !!onToggleCheck && (checkedNames?.size ?? 0) > 0;
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
          const checked = checkedNames?.has(r.name) ?? false;
          return (
            <li key={r.name} className={cn(
              "group flex items-stretch gap-1 rounded-lg border transition-colors",
              active
                ? "border-primary/50 bg-primary/10"
                : "border-transparent hover:border-border hover:bg-accent/40",
            )}>
              {onToggleCheck && (
                <div className={cn(
                  "flex shrink-0 items-start pl-2 pt-2.5 transition-opacity",
                  selecting || checked ? "opacity-100" : "opacity-0 focus-within:opacity-100 group-hover:opacity-100",
                )}>
                  <SelectCheckbox
                    checked={checked}
                    onToggle={() => onToggleCheck(r)}
                    label={t("project.routines.select_row", { name: r.name })}
                    testId={`routine-check-${r.name}`}
                  />
                </div>
              )}
              <button
                type="button"
                onClick={() => onSelect(r.name)}
                aria-current={active}
                className={cn(
                  "min-w-0 flex-1 rounded-lg py-2 pr-2.5 text-left",
                  onToggleCheck ? "pl-1.5" : "pl-2.5",
                )}
              >
                <div className="flex items-center gap-2">
                  <span className={cn("flex size-6 shrink-0 items-center justify-center rounded-md", r.enabled ? toneTint.emerald : "bg-muted text-muted-fg")}>
                    <Icon size={13} />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{r.name}</span>
                  {!r.enabled && <span className="shrink-0 text-[10px] text-muted-fg">{t("project.routines.paused")}</span>}
                  <StatusDot ok={r.last_status === "ok" ? true : r.last_status === "error" ? false : null} />
                </div>
                <div className="mt-1 flex items-center justify-between gap-2 pl-8 text-[10px] text-muted-fg">
                  {/* Who runs it beats what kind it is: four exec_agent routines
                      all read "Project agent", and the name is the thing you
                      are scanning the list for. */}
                  <span className="truncate">{agentSlug(r) || meta?.label || r.kind}</span>
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
