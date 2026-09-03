import { useState } from "react";
import useSWR from "swr";
import { ListTree, MessageSquare } from "lucide-react";
import { Tasks } from "../../lib/api";
import type { GlobalTaskEntry } from "../../lib/api/tasks";
import { Loading } from "../ui";
import { useToast } from "../Toast";
import { CategoryIcon, StatusFooter, StatusIcon, effectiveStatus, statusTint } from "./taskStatus";
import { DONE_COLUMN, columnFor, columnLabel, type BoardColumn } from "./columns";
import { cn } from "../../lib/cn";
import { t } from "../../i18n";
import { toneText } from "../../lib/tone";
import type { TaskEntry } from "../../types/daemon";

/**
 * The board. Columns come from config (core/tasks/columns.js): one global
 * catalog, each project showing the subset it picked, `done` always last.
 *
 * Drag-and-drop is the platform's own — no library. A board of this size does
 * not need a collision engine, and adding one to the panel's dependency list
 * for four columns of cards would cost more than it returns.
 *
 * DROPPING IS THE SAME VERB THE LIST USES. A card into `done` calls the same
 * endpoint the checkbox does; a card out of `done` reopens and then sets the
 * column. Nothing here is a board-only code path, which is why the list keeps
 * working exactly as it did.
 */

/** A board wants the whole set, not one page — a column that stops at 20 lies. */
const BOARD_LIMIT = 300;

export function TaskBoard({
  pid, columns, state, selectedId, onSelect, onChanged, refreshKey,
}: {
  /** Undefined on the aggregated view: every project at once. */
  pid?: string;
  columns: BoardColumn[];
  /**
   * The screen's Open/Done/Dropped/All filter. It used to be ignored here —
   * the chips were on screen and did nothing, which is worse than not having
   * them — so the board fetched everything and quietly dropped the archive.
   */
  state: "open" | "done" | "dropped" | "all";
  selectedId: string | null;
  onSelect: (id: string) => void;
  onChanged: () => void;
  /** Bumped by the parent to force a refetch after an outside change. */
  refreshKey?: number;
}) {
  const toast = useToast();
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);

  const key = `board:${pid ?? "all"}:${state}:${refreshKey ?? 0}`;
  const { data, isLoading, mutate } = useSWR(key, () =>
    pid
      ? Tasks.listPage(pid, { state, limit: BOARD_LIMIT, offset: 0 }).then((r) => r.items)
      : Tasks.globalPage({ state, limit: BOARD_LIMIT, offset: 0 }).then((r) => r.items),
  );

  const live = (data ?? []) as TaskEntry[];
  const rowPid = (task: TaskEntry) => pid ?? String((task as GlobalTaskEntry).project_id ?? "");

  const refresh = () => { void mutate(); onChanged(); };

  const move = async (task: TaskEntry, to: string) => {
    const from = columnFor(task, columns);
    if (from === to) return;
    const p = rowPid(task);
    try {
      if (to === DONE_COLUMN) {
        await Tasks.done(p, task.id);
      } else {
        // Coming back from done: reopen first, or the status change lands on a
        // task the board would still draw in the last column.
        if (task.state !== "open") await Tasks.reopen(p, task.id);
        await Tasks.status(p, task.id, to as TaskEntry["status"] & string);
      }
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.error_generic"));
    }
  };

  if (isLoading) return <Loading />;

  return (
    <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto p-3" data-testid="task-board">
      {columns.map((col) => {
        const cards = live.filter((x) => columnFor(x, columns) === col.id);
        const isOver = over === col.id;
        return (
          <section
            key={col.id}
            data-testid={`board-col-${col.id}`}
            onDragOver={(e) => { e.preventDefault(); setOver(col.id); }}
            onDragLeave={() => setOver((c) => (c === col.id ? null : c))}
            onDrop={(e) => {
              e.preventDefault();
              setOver(null);
              const id = e.dataTransfer.getData("text/plain");
              const task = live.find((x) => x.id === id);
              if (task) void move(task, col.id);
            }}
            className={cn(
              "flex w-64 shrink-0 flex-col rounded-lg border transition-colors",
              isOver ? "border-primary bg-primary/5" : "border-border bg-muted/20",
            )}
          >
            <header className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-2.5 py-2">
              <span className="truncate text-[11px] font-semibold uppercase tracking-wide">
                {columnLabel(col)}
              </span>
              <span className="shrink-0 text-[10px] text-muted-fg">{cards.length}</span>
            </header>

            <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto p-2">
              {cards.map((task) => {
                const due = task.due ? String(task.due).slice(0, 10) : null;
                const overdue = task.state === "open" && !!due && due < new Date().toISOString().slice(0, 10);
                const project = (task as GlobalTaskEntry).project_name;
                const eff = effectiveStatus(task);
                return (
                  <article
                    key={`${rowPid(task)}-${task.id}`}
                    draggable
                    data-testid={`board-card-${task.id}`}
                    onDragStart={(e) => {
                      e.dataTransfer.setData("text/plain", task.id);
                      e.dataTransfer.effectAllowed = "move";
                      setDragging(task.id);
                    }}
                    onDragEnd={() => setDragging(null)}
                    onClick={() => onSelect(task.id)}
                    className={cn(
                      "cursor-grab rounded-md border bg-card p-2 text-left active:cursor-grabbing",
                      dragging === task.id && "opacity-40",
                      task.id === selectedId ? "border-primary/60 ring-1 ring-primary/30" : "border-border",
                    )}
                  >
                    <div className="flex items-start gap-1.5">
                      {/* The card's OWN state, not the column's. Hardcoding it
                          to the column made every card in every working column
                          identical — you could not tell a dropped card from a
                          live one without opening it. */}
                      <span className={cn("mt-0.5 flex size-4 shrink-0 items-center justify-center rounded", statusTint(eff))}>
                        <StatusIcon status={eff} className="size-2.5" />
                      </span>
                      <CategoryIcon category={task.category} />
                      <span className={cn(
                        "min-w-0 flex-1 break-words text-xs leading-snug",
                        task.state !== "open" && "text-muted-fg line-through decoration-muted-fg/40",
                      )}>
                        {task.title}
                      </span>
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-muted-fg">
                      {/* Which project a card belongs to is the first thing you
                          need on the aggregated board — every card looks alike
                          until you know it. */}
                      {project && <span className="truncate font-medium">{project.split("/").pop()}</span>}
                      {task.agent && <span>@{task.agent}</span>}
                      {!!task.subtask_count && (
                        <span className="inline-flex items-center gap-0.5">
                          <ListTree size={9} />{task.subtask_done ?? 0}/{task.subtask_count}
                        </span>
                      )}
                      {!!task.comment_count && (
                        <span className="inline-flex items-center gap-0.5">
                          <MessageSquare size={9} />{task.comment_count}
                        </span>
                      )}
                      {due && <span className={cn(overdue && cn("font-medium", toneText.red))}>⏱ {due}</span>}
                    </div>
                    {/* The status on the bottom edge, even though the column
                        already implies it: it is the one element that reads the
                        same here and in the list, where nothing said it at all. */}
                    <StatusFooter status={eff} className="mt-1.5 border-t border-border/60 pt-1.5" />
                  </article>
                );
              })}
              {cards.length === 0 && (
                <p className="px-1 py-4 text-center text-[10px] text-muted-fg">{t("tasks.board_empty_col")}</p>
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}
