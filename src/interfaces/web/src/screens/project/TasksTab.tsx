import { useState } from "react";
import useSWR from "swr";
import { Check, Plus, RotateCcw, Trash2 } from "lucide-react";
import { Tasks } from "../../lib/api";
import { Section } from "../../components/Section";
import { Badge, Button, Empty, Field, Input, Loading } from "../../components/ui";
import { useToast } from "../../components/Toast";
import { t } from "../../i18n";

export function TasksTab({ pid }: { pid: string }) {
  const [state, setState] = useState<"open" | "done" | "dropped">("open");
  const toast = useToast();
  // dedupingInterval:0 so switching the state filter always revalidates the
  // target list instead of showing the stale cached page from a prior switch.
  const list = useSWR(
    `/projects/${pid}/tasks?state=${state}`,
    () => Tasks.list(pid, state),
    { dedupingInterval: 0, revalidateOnFocus: true },
  );
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  const add = async () => {
    if (!draft.trim()) return;
    setBusy(true);
    try {
      await Tasks.add(pid, { title: draft.trim() });
      setDraft("");
      toast.success(t("project.tasks.created"));
      list.mutate();
    } catch (e: any) {
      toast.error(e?.message || t("project.tasks.create_error"));
    } finally {
      setBusy(false);
    }
  };
  const mark = async (fn: () => Promise<unknown>, label: string) => {
    try { await fn(); toast.success(label); list.mutate(); }
    catch (e: any) { toast.error(e?.message || t("common.error_generic")); }
  };

  return (
    <Section
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
      <div className="mb-4 flex items-end gap-2">
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

      {list.isLoading && <Loading />}
      {!list.isLoading && (list.data?.length ?? 0) === 0 && (
        <Empty>
          {state === "open"
            ? t("project.tasks.empty_open")
            : t("project.tasks.empty", { state })}
          {" "}<code>apx task add "…"</code>
        </Empty>
      )}

      <ul className="space-y-2 text-sm" data-testid="task-list">
        {(list.data || []).map((task) => (
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
    </Section>
  );
}
