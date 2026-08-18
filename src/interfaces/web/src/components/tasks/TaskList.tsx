import type { ReactNode } from "react";
import { Check, Pencil, RotateCcw, Trash2 } from "lucide-react";
import { Tasks } from "../../lib/api";
import type { GlobalTaskEntry } from "../../lib/api/tasks";
import type { TaskEntry } from "../../types/daemon";
import { RowMenu } from "../RowMenu";
import { DropdownMenuItem, DropdownMenuSeparator } from "../ui/dropdown-menu";
import { useToast } from "../Toast";
import { StatusIcon, effectiveStatus, statusTint } from "./taskStatus";
import { cn } from "../../lib/cn";
import { t } from "../../i18n";

/**
 * Left column: the tasks, one compact row each. Same shape as the routines
 * list next door — picking a row opens it on the right, and the "⋯" carries
 * the verbs so switching between tasks stays a single click.
 *
 * The row is deliberately two lines: in a 260px column a single line either
 * eats the title or drops everything else.
 */
export function TaskList({
  tasks,
  pid,
  selectedId,
  onSelect,
  onEdit,
  onChanged,
  footer,
  className,
}: {
  tasks: TaskEntry[];
  /** Resolves the owning project for a row (cross-project list carries its own). */
  pid: (task: TaskEntry) => string;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onEdit: (task: TaskEntry) => void;
  onChanged: () => void;
  /** Pager, when the set is bigger than one page. */
  footer?: ReactNode;
  /** Frame (width / borders) — the screen owns how the two panes sit. */
  className?: string;
}) {
  const toast = useToast();

  const act = async (fn: () => Promise<unknown>, label: string) => {
    try {
      await fn();
      toast.success(label);
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.error_generic"));
    }
  };

  return (
    <aside className={cn("flex min-h-0 flex-col", className)}>
      <div className="shrink-0 px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted-fg">
        {t("tasks.list_title")}
      </div>
      <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto p-2 pt-0" data-testid="task-list">
        {tasks.map((task) => {
          const eff = effectiveStatus(task);
          const active = task.id === selectedId;
          const taskPid = pid(task);
          const due = task.due ? String(task.due).slice(0, 10) : null;
          const overdue = task.state === "open" && !!due && due < new Date().toISOString().slice(0, 10);
          const project = (task as GlobalTaskEntry).project_name;
          return (
            <li
              key={`${taskPid}-${task.id}`}
              data-testid={`task-${task.id}`}
              className={cn(
                "flex items-start gap-1 rounded-lg border transition-colors",
                active
                  ? "border-primary/50 bg-primary/10"
                  : "border-transparent hover:border-border hover:bg-accent/40",
              )}
            >
              <button
                type="button"
                onClick={() => onSelect(task.id)}
                aria-current={active}
                className="min-w-0 flex-1 px-2.5 py-2 text-left"
              >
                <div className="flex items-center gap-2">
                  <span className={cn("flex size-6 shrink-0 items-center justify-center rounded-md", statusTint(eff))}>
                    <StatusIcon status={eff} className="size-3.5" />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{task.title}</span>
                </div>
                <div className="mt-1 flex items-center justify-between gap-2 pl-8 text-[10px] text-muted-fg">
                  <span className="truncate">
                    {project ? `${project.split("/").pop()}${task.agent ? " · " : ""}` : ""}
                    {task.agent ? `@${task.agent}` : (project ? "" : t("tasks.agent_none_short"))}
                  </span>
                  {due && <span className={cn("shrink-0", overdue && "font-medium text-red-500")}>⏱ {due}</span>}
                </div>
              </button>

              <div className="pr-1 pt-2">
                <RowMenu label={t("tasks.row_actions")} testId={`task-menu-${task.id}`}>
                  <DropdownMenuItem onClick={() => onEdit(task)} data-testid={`task-edit-${task.id}`}>
                    <Pencil size={15} className="text-muted-fg" />
                    {t("common.edit")}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  {task.state === "open" ? (
                    <>
                      <DropdownMenuItem
                        data-testid={`task-done-${task.id}`}
                        onClick={() => act(() => Tasks.done(taskPid, task.id), t("project.tasks.done"))}
                      >
                        <Check size={15} className="text-emerald-500" />
                        {t("tasks.mark_done")}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        variant="destructive"
                        data-testid={`task-drop-${task.id}`}
                        onClick={() => act(() => Tasks.drop(taskPid, task.id), t("project.tasks.drop"))}
                      >
                        <Trash2 size={15} />
                        {t("tasks.mark_dropped")}
                      </DropdownMenuItem>
                    </>
                  ) : (
                    <DropdownMenuItem
                      data-testid={`task-reopen-${task.id}`}
                      onClick={() => act(() => Tasks.reopen(taskPid, task.id), t("project.tasks.reopen"))}
                    >
                      <RotateCcw size={15} className="text-muted-fg" />
                      {t("tasks.mark_reopen")}
                    </DropdownMenuItem>
                  )}
                </RowMenu>
              </div>
            </li>
          );
        })}
      </ul>
      {footer ? <div className="shrink-0 border-t border-border px-3 py-2">{footer}</div> : null}
    </aside>
  );
}
