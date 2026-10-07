import { Badge } from "../ui";
import { t } from "../../i18n";
import type { TaskDependency, TaskEntry } from "../../types/daemon";

function stateBadge(d: { state: string; satisfied?: boolean }) {
  if (d.state === "missing") return <Badge tone="danger">{t("tasks.dep_state_missing")}</Badge>;
  if (d.state === "dropped") return <Badge tone="warning">{t("tasks.dep_state_dropped")}</Badge>;
  if (d.state === "done" || d.satisfied) return <Badge tone="success">{t("tasks.dep_state_done")}</Badge>;
  return <Badge tone="info">{t("tasks.dep_state_open")}</Badge>;
}

/**
 * Who this task waits on and whom it unblocks (#59). A closed dependency
 * unblocks the next step — it does not approve it, and the copy says so.
 */
export function TaskDependencies({ task, onOpenTask }: { task: TaskEntry; onOpenTask?: (id: string) => void }) {
  const waits = task.depends_on ?? [];
  const blocks = task.blocks ?? [];
  const lifted = task.dependency_log ?? [];
  if (!waits.length && !blocks.length && !lifted.length) return null;

  const link = (id: string, title: string | null) => (
    <button type="button" className="truncate text-left font-medium hover:underline" onClick={() => onOpenTask?.(id)}>
      {title || id}
    </button>
  );

  return (
    <div className="space-y-2 rounded-lg border border-border p-3 text-xs" data-testid="task-dependencies">
      {waits.length > 0 && (
        <div className="space-y-1">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-fg">{t("tasks.dep_waits_on")}</div>
          {waits.map((d: TaskDependency) => (
            <div key={d.task_id} className="space-y-0.5" data-testid={`task-dep-${d.task_id}`}>
              <div className="flex items-center gap-2">{stateBadge(d)}{link(d.task_id, d.title)}</div>
              {(d.reason || d.condition || d.owner) && (
                <div className="pl-1 text-muted-fg">
                  {d.reason && <span>{d.reason}</span>}
                  {d.condition && <span>{d.reason ? " · " : ""}{t("tasks.dep_condition")}: {d.condition}</span>}
                  {d.owner && <span> · {t("tasks.dep_owner")}: {d.owner}</span>}
                </div>
              )}
            </div>
          ))}
          {waits.some((d) => d.satisfied) && <p className="text-muted-fg">{t("tasks.dep_not_approval")}</p>}
        </div>
      )}
      {blocks.length > 0 && (
        <div className="space-y-1">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-fg">{t("tasks.dep_unblocks")}</div>
          {blocks.map((b) => (
            <div key={b.task_id} className="flex items-center gap-2" data-testid={`task-blocks-${b.task_id}`}>
              {stateBadge(b)}{link(b.task_id, b.title)}
            </div>
          ))}
        </div>
      )}
      {lifted.length > 0 && (
        <details className="text-muted-fg">
          <summary className="cursor-pointer">{t("tasks.dep_lifted", { n: lifted.length })}</summary>
          {lifted.map((d, i) => (
            <div key={`${d.task_id}-${i}`} className="pl-2">
              {d.task_id}: {d.removed_reason}{d.removed_by ? ` · ${d.removed_by}` : ""}
            </div>
          ))}
        </details>
      )}
    </div>
  );
}
