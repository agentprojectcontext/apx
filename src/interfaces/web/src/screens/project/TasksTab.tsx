import { useState } from "react";
import { Check, Plus, RotateCcw, Trash2 } from "lucide-react";
import { Tasks } from "../../lib/api";
import { Section } from "../../components/Section";
import { PagedList, usePagedQuery } from "../../components/Pager";
import { Badge, Button, Empty, Field, Input, Loading } from "../../components/ui";
import { useToast } from "../../components/Toast";
import { t } from "../../i18n";

export function TasksTab({ pid }: { pid: string }) {
  const [state, setState] = useState<"open" | "done" | "dropped">("open");
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
  const [busy, setBusy] = useState(false);

  const add = async () => {
    if (!draft.trim()) return;
    setBusy(true);
    try {
      await Tasks.add(pid, { title: draft.trim() });
      setDraft("");
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
              {s}
            </Button>
          ))}
        </div>
      }
    >
      <div className="mb-4 flex shrink-0 items-end gap-2">
        <Field label={t("project.tasks.add_label")}>
          <Input
            data-testid="task-input"
            placeholder={t("project.tasks.add_placeholder")}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") add(); }}
          />
        </Field>
        <Button variant="primary" data-testid="task-add" onClick={add} loading={busy}>
          <Plus size={14} /> {t("project.tasks.add")}
        </Button>
      </div>

      {paged.isLoading && <Loading />}
      {!paged.isLoading && paged.total === 0 && (
        <Empty>
          {state === "open"
            ? t("project.tasks.empty_open")
            : t("project.tasks.empty", { state })}
          {" "}<code>apx task add "…"</code>
        </Empty>
      )}

      <PagedList paged={paged} fullHeight>
        <ul className="space-y-2 text-sm" data-testid="task-list">
          {paged.items.map((task) => (
            <li key={task.id} data-testid={`task-${task.id}`} className="flex items-start gap-3 rounded-md border border-border bg-muted/30 px-3 py-2">
            <span className="mt-0.5 font-mono text-[10px] text-muted-fg">{task.id}</span>
            <div className="flex-1">
              <div className="font-medium">{task.title}</div>
              <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-fg">
                {task.tags?.map((tag) => <Badge key={tag}>#{tag}</Badge>)}
                {task.agent && <Badge tone="info">@{task.agent}</Badge>}
                {task.source && <span>{t("project.tasks.via")} {task.source}</span>}
                {task.due && <span>{t("project.tasks.due")} {task.due}</span>}
              </div>
            </div>
            <div className="flex gap-1">
              {state === "open" && (
                <>
                  <Button size="sm" variant="secondary" aria-label={t("project.tasks.aria_done")} data-testid={`task-done-${task.id}`} onClick={() => mark(() => Tasks.done(pid, task.id), t("project.tasks.done"))}>
                    <Check size={13} />
                  </Button>
                  <Button size="sm" variant="destructive" aria-label={t("project.tasks.aria_drop")} data-testid={`task-drop-${task.id}`} onClick={() => mark(() => Tasks.drop(pid, task.id), t("project.tasks.drop"))}>
                    <Trash2 size={13} />
                  </Button>
                </>
              )}
              {state !== "open" && (
                <Button size="sm" variant="ghost" aria-label={t("project.tasks.aria_reopen")} data-testid={`task-reopen-${task.id}`} onClick={() => mark(() => Tasks.reopen(pid, task.id), t("project.tasks.reopen"))}>
                  <RotateCcw size={13} />
                </Button>
              )}
            </div>
          </li>
        ))}
        </ul>
      </PagedList>
    </Section>
  );
}
