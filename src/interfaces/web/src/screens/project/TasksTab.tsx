import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Plus, ChevronDown, ChevronUp, Check, Trash2, RotateCcw } from "lucide-react";
import { Tasks } from "../../lib/api";
import { Section } from "../../components/Section";
import { PagedList, usePagedQuery } from "../../components/Pager";
import { Badge, Button, Empty, Field, Input, Loading, Textarea } from "../../components/ui";
import { useToast } from "../../components/Toast";
import { StatusIcon, StatusBadge, effectiveStatus } from "../../components/tasks/taskStatus";
import { TaskDetailPanel } from "../../components/tasks/TaskDetailPanel";
import { t } from "../../i18n";

export function TasksTab({ pid }: { pid: string }) {
  const [state, setState] = useState<"open" | "done" | "dropped">("open");
  const [params, setParams] = useSearchParams();
  const selected = params.get("task");
  const toast = useToast();
  // dedupingInterval:0 so switching the state filter always revalidates the
  // target page instead of showing the stale cached one from a prior switch.
  const paged = usePagedQuery({
    key: `/projects/${pid}/tasks?state=${state}`,
    fetchPage: (limit, offset) => Tasks.listPage(pid, { state, limit, offset }),
    resetKey: state,
    swr: { dedupingInterval: 0, revalidateOnFocus: true },
  });
  const [draft, setDraft] = useState("");
  const [body, setBody] = useState("");
  const [showBody, setShowBody] = useState(false);
  const [busy, setBusy] = useState(false);

  const select = (id: string | null) => {
    const next = new URLSearchParams(params);
    if (id) next.set("task", id); else next.delete("task");
    setParams(next, { replace: true });
  };

  const add = async () => {
    if (!draft.trim()) return;
    setBusy(true);
    try {
      await Tasks.add(pid, { title: draft.trim(), body: body.trim() || null, source: "web" });
      setDraft(""); setBody(""); setShowBody(false);
      toast.success(t("project.tasks.created"));
      paged.mutate();
    } catch (e: any) {
      toast.error(e?.message || t("project.tasks.create_error"));
    } finally {
      setBusy(false);
    }
  };
  const mark = async (fn: () => Promise<unknown>, label: string) => {
    try { await fn(); toast.success(label); paged.mutate(); }
    catch (e: any) { toast.error(e?.message || t("common.error_generic")); }
  };

  return (
    <Section
      fullHeight
      title={t("project.tasks.title")}
      description={t("project.tasks.subtitle")}
      action={
        <div className="flex gap-1">
          {(["open", "done", "dropped"] as const).map((s) => (
            <Button key={s} size="sm" data-testid={`task-filter-${s}`} variant={state === s ? "primary" : "ghost"} onClick={() => setState(s)}>
              {t(`tasks.state_${s}` as never)}
            </Button>
          ))}
        </div>
      }
    >
      <div className="mb-4 shrink-0 space-y-2">
        <div className="flex items-end gap-2">
          <Field label={t("project.tasks.add_label")}>
            <Input
              data-testid="task-input"
              placeholder={t("project.tasks.add_placeholder")}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !showBody) add(); }}
            />
          </Field>
          <Button variant="ghost" size="sm" onClick={() => setShowBody((v) => !v)} aria-label={t("tasks.toggle_prompt")}>
            {showBody ? <ChevronUp size={14} /> : <ChevronDown size={14} />} {t("tasks.field_prompt")}
          </Button>
          <Button variant="primary" data-testid="task-add" onClick={add} loading={busy}>
            <Plus size={14} /> {t("project.tasks.add")}
          </Button>
        </div>
        {showBody && (
          <Textarea rows={3} value={body} onChange={(e) => setBody(e.target.value)} placeholder={t("tasks.prompt_ph")} className="text-xs" />
        )}
      </div>

      <div className="flex min-h-0 flex-1 gap-4">
        <div className="flex min-w-0 flex-1 flex-col">
          {paged.isLoading && <Loading />}
          {!paged.isLoading && paged.total === 0 && (
            <Empty>
              {state === "open" ? t("project.tasks.empty_open") : t("project.tasks.empty", { state })}
              {" "}<code>apx task add "…"</code>
            </Empty>
          )}

          <PagedList paged={paged} fullHeight>
            <ul className="space-y-2 text-sm" data-testid="task-list">
              {paged.items.map((task) => {
                const eff = effectiveStatus(task);
                return (
                  <li
                    key={task.id}
                    data-testid={`task-${task.id}`}
                    onClick={() => select(task.id)}
                    className={`flex cursor-pointer items-start gap-3 rounded-md border px-3 py-2 hover:border-muted-fg/50 ${selected === task.id ? "border-primary/50 bg-primary/5" : "border-border bg-muted/30"}`}
                  >
                    <StatusIcon status={eff} className="mt-0.5 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{task.title}</div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-fg">
                        {task.state === "open" && <StatusBadge status={eff} />}
                        {task.tags?.map((tag) => <Badge key={tag}>#{tag}</Badge>)}
                        {task.agent && <Badge tone="info">@{task.agent}</Badge>}
                        {task.due && <span>{t("project.tasks.due")} {task.due}</span>}
                      </div>
                    </div>
                    <div className="flex shrink-0 gap-1" onClick={(e) => e.stopPropagation()}>
                      {task.state === "open" ? (
                        <>
                          <Button size="sm" variant="secondary" aria-label={t("project.tasks.aria_done")} data-testid={`task-done-${task.id}`} onClick={() => mark(() => Tasks.done(pid, task.id), t("project.tasks.done"))}>
                            <Check size={13} />
                          </Button>
                          <Button size="sm" variant="destructive" aria-label={t("project.tasks.aria_drop")} data-testid={`task-drop-${task.id}`} onClick={() => mark(() => Tasks.drop(pid, task.id), t("project.tasks.drop"))}>
                            <Trash2 size={13} />
                          </Button>
                        </>
                      ) : (
                        <Button size="sm" variant="ghost" aria-label={t("project.tasks.aria_reopen")} data-testid={`task-reopen-${task.id}`} onClick={() => mark(() => Tasks.reopen(pid, task.id), t("project.tasks.reopen"))}>
                          <RotateCcw size={13} />
                        </Button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </PagedList>
        </div>

        {selected && (
          <TaskDetailPanel
            pid={pid}
            taskId={selected}
            onClose={() => select(null)}
            onChanged={() => paged.mutate()}
          />
        )}
      </div>
    </Section>
  );
}
