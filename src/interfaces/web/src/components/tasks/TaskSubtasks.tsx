import { useState } from "react";
import useSWR from "swr";
import { Plus } from "lucide-react";
import { Tasks } from "../../lib/api";
import { Button, Input } from "../ui";
import { useToast } from "../Toast";
import { StatusIcon, effectiveStatus, statusTint } from "./taskStatus";
import { cn } from "../../lib/cn";
import { t } from "../../i18n";
import type { TaskEntry } from "../../types/daemon";

/**
 * The children of a task — an epic's real units of work.
 *
 * A SUBTASK IS A TASK. Same store, same verbs, same row: it can be assigned to
 * an agent, moved through the board, commented on and closed on its own. That
 * is the whole reason it is a `parent` field and not a second kind of thing —
 * "one task that is really five" was unworkable precisely because those five
 * could not be handed out, moved to QA or ticked off separately.
 *
 * Opening one navigates to it, where it is an ordinary task with its own
 * detail, thread and children.
 */
export function TaskSubtasks({
  pid, taskId, onOpen, onChanged,
}: {
  pid: string;
  taskId: string;
  /** Select this child in the list next door. */
  onOpen: (id: string) => void;
  /** The parent's counters moved — re-fetch it. */
  onChanged: () => void;
}) {
  const toast = useToast();
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const key = `/api/projects/${pid}/tasks?parent=${taskId}`;
  const { data: kids, mutate } = useSWR(key, () => Tasks.subtasks(pid, taskId));

  const rows = kids ?? [];
  const done = rows.filter((k) => k.state === "done").length;

  const refresh = () => { void mutate(); onChanged(); };

  const add = async () => {
    const name = title.trim();
    if (!name || busy) return;
    setBusy(true);
    try {
      await Tasks.add(pid, { title: name, parent: taskId, source: "web" } as Partial<TaskEntry>);
      setTitle("");
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.error_generic"));
    } finally {
      setBusy(false);
    }
  };

  const tick = async (task: TaskEntry) => {
    try {
      await (task.state === "open" ? Tasks.done(pid, task.id) : Tasks.reopen(pid, task.id));
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.error_generic"));
    }
  };

  return (
    <div className="space-y-1.5">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-fg">
        {t("tasks.subtasks_title")}
        {rows.length ? ` (${done}/${rows.length})` : ""}
      </div>

      <div className="overflow-hidden rounded-lg border border-border">
        {rows.length > 0 && (
          <ul className="divide-y divide-border" data-testid="task-subtasks">
            {rows.map((k) => {
              const eff = effectiveStatus(k);
              return (
                <li key={k.id} className="flex items-center gap-2 px-2 py-1.5">
                  <button
                    type="button"
                    onClick={() => tick(k)}
                    data-testid={`subtask-tick-${k.id}`}
                    aria-label={t(k.state === "open" ? "tasks.tick_done" : "tasks.tick_reopen", { title: k.title })}
                    className={cn("flex size-5 shrink-0 items-center justify-center rounded", statusTint(eff))}
                  >
                    <StatusIcon status={eff} className="size-3" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onOpen(k.id)}
                    data-testid={`subtask-open-${k.id}`}
                    className={cn(
                      "min-w-0 flex-1 truncate text-left text-xs hover:underline",
                      k.state !== "open" && "text-muted-fg line-through decoration-muted-fg/40",
                    )}
                  >
                    {k.title}
                  </button>
                  {k.agent && <span className="shrink-0 text-[10px] text-muted-fg">@{k.agent}</span>}
                </li>
              );
            })}
          </ul>
        )}

        <div className={cn("flex items-center gap-2 p-2", rows.length > 0 && "border-t border-border")}>
          <Input
            value={title}
            data-testid="subtask-input"
            placeholder={t("tasks.subtask_ph")}
            className="text-xs"
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void add(); } }}
          />
          <Button size="sm" loading={busy} disabled={!title.trim()} data-testid="subtask-add" onClick={add}>
            <Plus size={13} />
          </Button>
        </div>
      </div>
    </div>
  );
}
