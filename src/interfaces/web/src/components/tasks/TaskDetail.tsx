import { useState } from "react";
import useSWR from "swr";
import { Check, ExternalLink, Pencil, RotateCcw, Trash2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Tasks } from "../../lib/api";
import { Badge, Button, Spinner, Tip } from "../ui";
import { UiSelect } from "../UiSelect";
import { ReadOnlyBlock } from "../ReadOnlyBlock";
import { useToast } from "../Toast";
import { StatusIcon, StatusBadge, effectiveStatus, statusTint, TASK_STATUS_ORDER, statusLabel } from "./taskStatus";
import { relativeWhen } from "../../lib/when";
import { cn } from "../../lib/cn";
import { t } from "../../i18n";
import { toneOutline, toneText } from "../../lib/tone";
import type { TaskEntry, TaskStatus } from "../../types/daemon";

/**
 * Right column: the selected task, open by default.
 *
 * Reads like the routine detail on purpose — name and the verbs on the top
 * line, a compact meta strip under it, then the content. Every FIELD is edited
 * in the one task form (the "Edit" button here and the row's ⋯ open the same
 * dialog); only the workflow status is changed in place, because that is a
 * move, not an edit.
 */
export function TaskDetail({
  pid, taskId, projectName, onEdit, onChanged,
}: {
  pid: string;
  taskId: string;
  /** Only on the cross-project list — says which project this one lives in. */
  projectName?: string;
  onEdit: (task: TaskEntry) => void;
  onChanged: () => void;
}) {
  const toast = useToast();
  const navigate = useNavigate();
  const { data: task, isLoading, mutate } = useSWR(
    `/api/projects/${pid}/tasks/${taskId}`,
    () => Tasks.get(pid, taskId),
  );
  const [busy, setBusy] = useState(false);

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try { await fn(); void mutate(); onChanged(); }
    catch (e) { toast.error(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  if (isLoading) return <div className="flex h-full items-center justify-center"><Spinner /></div>;
  if (!task) return null;

  const eff = effectiveStatus(task);
  const isOpen = task.state === "open";
  const due = task.due ? String(task.due).slice(0, 10) : null;
  const overdue = isOpen && !!due && due < new Date().toISOString().slice(0, 10);

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="task-detail">
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        {/* header: title + the verbs */}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-[12rem] flex-1 items-center gap-2">
            <span className={cn("flex size-7 shrink-0 items-center justify-center rounded-lg", statusTint(eff))}>
              <StatusIcon status={eff} className="size-4" />
            </span>
            {/* The title outranks the chips for width: the chips repeat what
                the icon and the meta strip already say. */}
            <h3 className="truncate text-base font-semibold" title={task.title}>{task.title}</h3>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button size="sm" variant="secondary" data-testid="task-detail-edit" onClick={() => onEdit(task)}>
              <Pencil size={13} /> {t("common.edit")}
            </Button>
            {isOpen ? (
              <>
                <Button size="sm" variant="primary" loading={busy} onClick={() => act(() => Tasks.done(pid, task.id))}>
                  <Check size={13} /> {t("tasks.mark_done")}
                </Button>
                <Tip content={t("tasks.mark_dropped")}>
                  <Button size="sm" variant="destructive" loading={busy} aria-label={t("tasks.mark_dropped")} onClick={() => act(() => Tasks.drop(pid, task.id))}>
                    <Trash2 size={13} />
                  </Button>
                </Tip>
              </>
            ) : (
              <Button size="sm" variant="secondary" loading={busy} onClick={() => act(() => Tasks.reopen(pid, task.id))}>
                <RotateCcw size={13} /> {t("tasks.mark_reopen")}
              </Button>
            )}
          </div>
        </div>

        {/* compact meta strip — the same row the routine detail uses */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-fg">
          <StatusBadge status={eff} />
          {projectName && <Badge tone="info">{projectName.split("/").pop() || projectName}</Badge>}
          <span className="font-mono text-[10px]">{task.id}</span>
          {task.agent && <span>@{task.agent}</span>}
          {due && (
            <span className={cn(overdue && cn("font-medium", toneText.red))}>
              {t("project.global_tasks.field_due")} {due}
            </span>
          )}
          {task.tags?.map((tag) => <span key={tag}>#{tag}</span>)}
          {task.source && <span>{t("tasks.field_source")}: {task.source}</span>}
          {task.created_by && <span>{t("tasks.field_creator")}: {task.created_by}</span>}
          <span title={new Date(task.created_at).toLocaleString()}>
            {t("tasks.field_created")} {relativeWhen(task.created_at, t as never)}
          </span>
          <span title={new Date(task.updated_at).toLocaleString()}>
            {t("tasks.field_updated")} {relativeWhen(task.updated_at, t as never)}
          </span>
          {task.done_at && (
            <span title={new Date(task.done_at).toLocaleString()}>
              {t("tasks.field_done")} {relativeWhen(task.done_at, t as never)}
            </span>
          )}
        </div>

        {/* Workflow status: a move, not a field — changed in place. */}
        {isOpen && (
          <div className="max-w-[16rem] space-y-1">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-fg">{t("tasks.field_status")}</div>
            <UiSelect
              value={task.status ?? "pending"}
              onChange={(v) => act(() => Tasks.status(pid, task.id, v as TaskStatus))}
              options={TASK_STATUS_ORDER.map((s) => ({ value: s, label: statusLabel(s) }))}
            />
          </div>
        )}

        <ReadOnlyBlock
          title={t("tasks.field_prompt")}
          body={task.body ?? ""}
          empty={t("tasks.prompt_hint")}
        />

        {task.thread && (
          <button
            type="button"
            onClick={() => navigate(`/p/${pid}/chat?thread=${task.thread}`)}
            className={cn("flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs hover:bg-sky-500/10", toneOutline.sky)}
          >
            <ExternalLink className="size-3.5" />{t("tasks.view_thread")}
          </button>
        )}
      </div>
    </div>
  );
}
