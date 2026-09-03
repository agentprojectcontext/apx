import { type ReactNode, useState } from "react";
import { Check, ListTree, MessageSquare, Pencil, RotateCcw, Trash2 } from "lucide-react";
import { Tasks } from "../../lib/api";
import type { GlobalTaskEntry } from "../../lib/api/tasks";
import type { TaskEntry } from "../../types/daemon";
import { RowMenu } from "../RowMenu";
import { ConfirmDialog } from "../common/ConfirmDialog";
import { SelectCheckbox } from "../common/SelectCheckbox";
import { DropdownMenuItem, DropdownMenuSeparator } from "../ui/dropdown-menu";
import { useToast } from "../Toast";
import { CategoryIcon, StatusIcon, effectiveStatus, statusTint } from "./taskStatus";
import { cn } from "../../lib/cn";
import { t } from "../../i18n";
import { toneText } from "../../lib/tone";

/**
 * Left column: the tasks, one compact row each. Same shape as the routines
 * list next door — picking a row opens it on the right, and the "⋯" carries
 * the verbs so switching between tasks stays a single click.
 *
 * The row is deliberately two lines: in a 260px column a single line either
 * eats the title or drops everything else.
 *
 * TICKING ONE OFF IS ONE CLICK. It used to be three plus a modal — open the
 * "⋯", pick "mark done", confirm — which is a lot of ceremony to cross out
 * "call the accountant", and the tasks piled up unticked because of it. The
 * status square on the left IS the checkbox now, and the undo lives in the
 * toast for the few seconds anyone wants it. Dropping still confirms: that one
 * says "this was never worth doing", and it is rare enough to be worth a beat.
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
  checkedIds,
  onToggleCheck,
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
  /** Multi-select: ids ticked for a bulk action (the screen owns the set). */
  checkedIds?: Set<string>;
  onToggleCheck?: (task: TaskEntry) => void;
}) {
  const toast = useToast();
  // Only `drop` still asks. `done` is reversible and now undoes from the toast.
  const [confirm, setConfirm] = useState<{ kind: "drop"; task: TaskEntry } | null>(null);
  const selecting = !!onToggleCheck && (checkedIds?.size ?? 0) > 0;

  const act = async (fn: () => Promise<unknown>, label: string, undo?: () => Promise<unknown>) => {
    try {
      await fn();
      toast.success(
        label,
        undo
          ? {
              label: t("tasks.undo"),
              onClick: () => {
                undo().then(onChanged).catch(() => toast.error(t("common.error_generic")));
              },
            }
          : undefined,
      );
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.error_generic"));
    }
  };

  /** The square on the left, used as a checkbox. Open → done; closed → open. */
  const tick = (task: TaskEntry) => {
    const p = pid(task);
    if (task.state === "open") {
      return act(
        () => Tasks.done(p, task.id),
        t("project.tasks.done"),
        () => Tasks.reopen(p, task.id),
      );
    }
    return act(() => Tasks.reopen(p, task.id), t("project.tasks.reopen"));
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
          const checked = checkedIds?.has(task.id) ?? false;
          return (
            <li
              key={`${taskPid}-${task.id}`}
              data-testid={`task-${task.id}`}
              className={cn(
                "group flex items-start gap-1 rounded-lg border transition-colors",
                active
                  ? "border-primary/50 bg-primary/10"
                  : "border-transparent hover:border-border hover:bg-accent/40",
              )}
            >
              {onToggleCheck && (
                // Hidden until you hover or a selection is already running, so
                // the list stays calm when you are just reading it.
                <div className={cn(
                  "shrink-0 self-stretch pl-2 pt-2.5 transition-opacity",
                  selecting || checked ? "opacity-100" : "opacity-0 focus-within:opacity-100 group-hover:opacity-100",
                )}>
                  <SelectCheckbox
                    checked={checked}
                    onToggle={() => onToggleCheck(task)}
                    label={t("tasks.select_row", { title: task.title })}
                    testId={`task-check-${task.id}`}
                  />
                </div>
              )}
              {/* Not nested inside the select button — a button inside a button
                  is invalid, and this one has to win the click. */}
              <button
                type="button"
                onClick={() => tick(task)}
                data-testid={`task-tick-${task.id}`}
                aria-label={t(task.state === "open" ? "tasks.tick_done" : "tasks.tick_reopen", { title: task.title })}
                className={cn("group/tick shrink-0 self-start py-2", onToggleCheck ? "pl-1.5" : "pl-2.5")}
              >
                <span
                  className={cn(
                    "relative flex size-6 items-center justify-center rounded-md transition-colors",
                    statusTint(eff),
                    "group-hover/tick:ring-2 group-hover/tick:ring-current/40",
                  )}
                >
                  <StatusIcon status={eff} className="size-3.5 transition-opacity group-hover/tick:opacity-0" />
                  {/* The hint that this square is clickable at all. */}
                  <Check
                    size={14}
                    className={cn(
                      "absolute opacity-0 transition-opacity group-hover/tick:opacity-100",
                      task.state === "open" ? toneText.emerald : "text-muted-fg",
                    )}
                  />
                </span>
              </button>

              <button
                type="button"
                onClick={() => onSelect(task.id)}
                aria-current={active}
                className="min-w-0 flex-1 py-2 pl-1.5 pr-2.5 text-left"
              >
                <div className="flex items-center gap-2">
                  <CategoryIcon category={task.category} />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{task.title}</span>
                </div>
                <div className="mt-1 flex items-center justify-between gap-2 text-[10px] text-muted-fg">
                  <span className="truncate">
                    {project ? `${project.split("/").pop()}${task.agent ? " · " : ""}` : ""}
                    {task.agent ? `@${task.agent}` : (project ? "" : t("tasks.agent_none_short"))}
                  </span>
                  <span className="flex shrink-0 items-center gap-1.5">
                    {/* What makes an epic legible from the list: "2/5" says this
                        row is really five, without opening it. Both counters
                        stay hidden at zero — a "0" on every row is noise. */}
                    {!!task.subtask_count && (
                      <span className="inline-flex items-center gap-0.5" title={t("tasks.subtasks_title")}>
                        <ListTree size={10} />{task.subtask_done ?? 0}/{task.subtask_count}
                      </span>
                    )}
                    {!!task.comment_count && (
                      <span className="inline-flex items-center gap-0.5" title={t("tasks.comments_title")}>
                        <MessageSquare size={10} />{task.comment_count}
                      </span>
                    )}
                    {due && <span className={cn(overdue && cn("font-medium", toneText.red))}>⏱ {due}</span>}
                  </span>
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
                        onClick={() => tick(task)}
                      >
                        <Check size={15} className={toneText.emerald} />
                        {t("tasks.mark_done")}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        variant="destructive"
                        data-testid={`task-drop-${task.id}`}
                        onClick={() => setConfirm({ kind: "drop", task })}
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

      <ConfirmDialog
        open={confirm?.kind === "drop"}
        onClose={() => setConfirm(null)}
        onConfirm={() => { if (confirm) return act(() => Tasks.drop(pid(confirm.task), confirm.task.id), t("project.tasks.drop")); }}
        title={t("tasks.confirm_drop_title")}
        description={confirm ? t("tasks.confirm_drop_desc", { title: confirm.task.title }) : ""}
        confirmLabel={t("tasks.mark_dropped")}
        testId="task-row-drop-confirm"
      />
    </aside>
  );
}
