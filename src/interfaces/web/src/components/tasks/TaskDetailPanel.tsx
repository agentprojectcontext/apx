import { useState, useEffect } from "react";
import useSWR from "swr";
import { X, Check, Trash2, RotateCcw, ExternalLink, Save } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Tasks } from "../../lib/api";
import { Button, Spinner, Textarea } from "../ui";
import { UiSelect } from "../UiSelect";
import { useToast } from "../Toast";
import { StatusBadge, effectiveStatus, TASK_STATUS_ORDER, statusLabel } from "./taskStatus";
import { t } from "../../i18n";
import type { TaskStatus } from "../../types/daemon";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-mono text-foreground/90">{children}</span>
    </div>
  );
}

// Right-hand task inspector: prompt/body, workflow status, who created it, the
// linked thread, timestamps, and lifecycle actions. Mirrors Panda's detail
// panel but wired to APX's task store.
export function TaskDetailPanel({
  pid, taskId, onClose, onChanged,
}: {
  pid: string;
  taskId: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const toast = useToast();
  const navigate = useNavigate();
  const { data: task, isLoading, mutate } = useSWR(`/projects/${pid}/tasks/${taskId}`, () => Tasks.get(pid, taskId));
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => { setBody(task?.body ?? ""); }, [task?.id, task?.body]);

  const refresh = () => { void mutate(); onChanged(); };
  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try { await fn(); refresh(); }
    catch (e) { toast.error(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  if (isLoading) return <div className="flex w-80 items-center justify-center border-l border-border"><Spinner /></div>;
  if (!task) return null;

  const eff = effectiveStatus(task);
  const isOpen = task.state === "open";
  const bodyDirty = body !== (task.body ?? "");

  return (
    <div className="flex w-80 shrink-0 flex-col border-l border-border bg-card/40" data-testid="task-detail">
      <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-2.5">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{t("tasks.detail_title")}</span>
        <button type="button" onClick={onClose} aria-label={t("common.close")} className="text-muted-foreground hover:text-foreground">
          <X className="size-4" />
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
        <div>
          <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">{t("tasks.field_title")}</div>
          <div className="text-sm font-semibold">{task.title}</div>
        </div>

        <div className="flex items-center gap-2">
          <StatusBadge status={eff} />
          <span className="font-mono text-[10px] text-muted-foreground">{task.id}</span>
        </div>

        {/* Prompt / body — editable */}
        <div>
          <div className="mb-1 flex items-center justify-between">
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{t("tasks.field_prompt")}</span>
            {bodyDirty && (
              <button type="button" onClick={() => act(async () => { await Tasks.patch(pid, task.id, { body }); toast.success(t("common.saved")); })} className="flex items-center gap-1 text-[10px] text-emerald-500 hover:text-emerald-400">
                <Save className="size-3" />{t("files.save")}
              </button>
            )}
          </div>
          <Textarea rows={4} value={body} onChange={(e) => setBody(e.target.value)} placeholder={t("tasks.prompt_ph")} className="text-xs" />
        </div>

        {/* Workflow status control (open tasks) */}
        {isOpen && (
          <div>
            <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">{t("tasks.field_status")}</div>
            <UiSelect
              value={task.status ?? "pending"}
              onChange={(v) => act(() => Tasks.status(pid, task.id, v as TaskStatus))}
              options={TASK_STATUS_ORDER.map((s) => ({ value: s, label: statusLabel(s) }))}
            />
          </div>
        )}

        <div className="space-y-1.5 rounded-lg border border-border bg-background/40 p-2.5">
          {task.agent && <Row label={t("tasks.field_agent")}>@{task.agent}</Row>}
          {task.created_by && <Row label={t("tasks.field_creator")}>{task.created_by}</Row>}
          {task.source && <Row label={t("tasks.field_source")}>{task.source}</Row>}
          {task.due && <Row label={t("project.tasks.due")}>{task.due}</Row>}
          <Row label={t("tasks.field_created")}>{new Date(task.created_at).toLocaleString()}</Row>
          <Row label={t("tasks.field_updated")}>{new Date(task.updated_at).toLocaleString()}</Row>
          {task.done_at && <Row label={t("tasks.field_done")}>{new Date(task.done_at).toLocaleString()}</Row>}
        </div>

        {/* Thread link */}
        {task.thread && (
          <button
            type="button"
            onClick={() => navigate(`/p/${pid}/chat?thread=${task.thread}`)}
            className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-sky-500/30 bg-sky-500/5 px-3 py-2 text-xs text-sky-500 hover:bg-sky-500/10"
          >
            <ExternalLink className="size-3.5" />{t("tasks.view_thread")}
          </button>
        )}
      </div>

      {/* Actions */}
      <div className="flex shrink-0 gap-2 border-t border-border px-4 py-3">
        {isOpen ? (
          <>
            <Button size="sm" variant="primary" className="flex-1" loading={busy} onClick={() => act(() => Tasks.done(pid, task.id))}>
              <Check size={13} />{t("tasks.mark_done")}
            </Button>
            <Button size="sm" variant="destructive" loading={busy} onClick={() => act(() => Tasks.drop(pid, task.id))} aria-label={t("project.tasks.aria_drop")}>
              <Trash2 size={13} />
            </Button>
          </>
        ) : (
          <Button size="sm" variant="secondary" className="flex-1" loading={busy} onClick={() => act(() => Tasks.reopen(pid, task.id))}>
            <RotateCcw size={13} />{t("project.tasks.reopen")}
          </Button>
        )}
      </div>
    </div>
  );
}
