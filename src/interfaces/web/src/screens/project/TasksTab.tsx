import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ListTodo, MousePointerClick, Plus } from "lucide-react";
import { Tasks } from "../../lib/api";
import type { GlobalTaskEntry } from "../../lib/api/tasks";
import type { TaskEntry, TaskStatus } from "../../types/daemon";
import { Section } from "../../components/Section";
import { Pager, usePagedQuery } from "../../components/Pager";
import { Button, Empty, FilterChips, Loading } from "../../components/ui";
import { TaskList } from "../../components/tasks/TaskList";
import { TaskDetail } from "../../components/tasks/TaskDetail";
import { TASK_STATUS_ORDER, statusLabel } from "../../components/tasks/taskStatus";
import { TaskFormDialog } from "../../components/tasks/TaskFormDialog";
import { BulkActionBar } from "../../components/tasks/BulkActionBar";
import { ConfirmDialog } from "../../components/common/ConfirmDialog";
import { useToast } from "../../components/Toast";
import { useProjects } from "../../hooks/useProjects";
import { t } from "../../i18n";

/**
 * Tasks — one screen, two scopes, master-detail like Routines.
 *
 * `pid` set = that project. `pid` omitted = every registered project, which is
 * what the base workspace shows. There used to be two components and they
 * drifted into two different products: the cross-project one could not filter
 * by status, mark anything done, or edit a title, and printed the raw state
 * word on a second line. The only thing scope changes now is the project chip
 * and where a new task is filed.
 *
 * One task is always open on the right — a list you can only stare at is a
 * report, not a workspace.
 */
export function TasksTab({ pid }: { pid?: string }) {
  const [params, setParams] = useSearchParams();
  const [state, setState] = useState<"open" | "done" | "dropped" | "all">("open");
  // Workflow sub-status is a different question from state: "what is blocked
  // right now" is not "what is open". Only meaningful for open tasks.
  const [status, setStatus] = useState<TaskStatus | "">("");
  const effStatus = state === "open" ? status : "";

  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<{ pid: string; task: TaskEntry } | null>(null);
  const { projects } = useProjects();
  const toast = useToast();

  // Multi-select. Keyed by task id but carries the resolved pid + task so a
  // bulk verb still works after the page moves or across projects (global view).
  const [checked, setChecked] = useState<Map<string, { pid: string; task: TaskEntry }>>(new Map());
  const [bulk, setBulk] = useState<"done" | "drop" | null>(null);

  // dedupingInterval:0 so switching a filter always revalidates the target page
  // instead of showing the stale cached one from a prior switch.
  const paged = usePagedQuery({
    key: `/api/tasks?pid=${pid ?? "all"}&state=${state}&status=${effStatus}`,
    fetchPage: (limit, offset) =>
      pid
        ? Tasks.listPage(pid, { state, limit, offset, status: effStatus })
        : Tasks.globalPage({ state, limit, offset, status: effStatus }),
    resetKey: `${pid ?? "all"}|${state}|${effStatus}`,
    swr: { dedupingInterval: 0, revalidateOnFocus: true },
  });

  const rowPid = (task: TaskEntry) => pid ?? String((task as GlobalTaskEntry).project_id ?? "");
  const selectedId = params.get("task");
  const selected = paged.items.find((x) => x.id === selectedId) || null;

  const select = (id: string | null) =>
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      if (id) next.set("task", id); else next.delete("task");
      return next;
    }, { replace: true });

  const toggleCheck = (task: TaskEntry) =>
    setChecked((prev) => {
      const next = new Map(prev);
      if (next.has(task.id)) next.delete(task.id);
      else next.set(task.id, { pid: rowPid(task), task });
      return next;
    });
  const clearChecked = () => setChecked(new Map());
  const checkedIds = new Set(checked.keys());

  // A filter switch changes what the ids even mean — drop the selection so a
  // bulk verb can never hit a task you can no longer see.
  useEffect(() => { setChecked(new Map()); }, [pid, state, effStatus]);

  const runBulk = async (kind: "done" | "drop") => {
    const entries = [...checked.values()];
    if (entries.length === 0) return;
    const results = await Promise.allSettled(
      entries.map(({ pid: p, task }) => (kind === "done" ? Tasks.done(p, task.id) : Tasks.drop(p, task.id))),
    );
    const failed = results.filter((r) => r.status === "rejected").length;
    const ok = entries.length - failed;
    if (ok > 0) toast.success(t(kind === "done" ? "tasks.bulk_done_toast" : "tasks.bulk_drop_toast", { count: ok }));
    if (failed > 0) toast.error(t("common.error_generic"));
    clearChecked();
    paged.mutate();
  };

  // Keep the first task selected, and heal a stale ?task (filter switched, the
  // task closed, the page moved).
  useEffect(() => {
    if (paged.items.length === 0) return;
    if (selectedId && paged.items.some((x) => x.id === selectedId)) return;
    select(paged.items[0].id);
  }, [paged.items, selectedId]); // eslint-disable-line react-hooks/exhaustive-deps

  const wantEdit = params.get("edit") === "1";
  const canOpenEditor = wantEdit && !!selected;
  useEffect(() => {
    if (!canOpenEditor || !selected) return;
    setEditing({ pid: rowPid(selected), task: selected });
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete("edit");
      return next;
    }, { replace: true });
  }, [canOpenEditor, selectedId]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Section
      fullHeight
      title={pid ? t("project.tasks.title") : t("project.global_tasks.title")}
      description={pid ? t("project.tasks.subtitle") : t("project.global_tasks.subtitle")}
      action={
        <Button size="sm" variant="primary" data-testid="task-new" onClick={() => setAdding(true)}>
          <Plus size={14} /> {t("project.global_tasks.add")}
        </Button>
      }
      filters={
        <>
          <FilterChips
            value={state}
            onChange={setState}
            testIdPrefix="task-filter"
            label={t("project.tasks.title")}
            options={(["open", "done", "dropped", "all"] as const).map((s) => ({
              value: s,
              label: s === "all" ? t("common.all") : t(`tasks.state_${s}` as never),
            }))}
          />
          {state === "open" ? (
            <div className="ml-2">
              <FilterChips
                value={status}
                onChange={setStatus}
                testIdPrefix="task-status-filter"
                label={t("project.global_tasks.any_status")}
                options={[
                  { value: "" as const, label: t("project.global_tasks.any_status") },
                  ...TASK_STATUS_ORDER.map((s) => ({ value: s, label: statusLabel(s) })),
                ]}
              />
            </div>
          ) : null}
        </>
      }
    >
      {paged.isLoading && <Loading />}
      {!paged.isLoading && paged.total === 0 && (
        <Empty icon={ListTodo}>
          {!pid ? t("project.global_tasks.empty")
            : state === "open" ? t("project.tasks.empty_open")
            : t("project.tasks.empty", { state })}
        </Empty>
      )}

      {paged.items.length > 0 && (
        <div className={"flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border lg:flex-row"}>
          <TaskList
            className={"max-h-64 shrink-0 border-b border-border lg:h-full lg:max-h-none lg:w-[280px] lg:border-b-0 lg:border-r"}
            tasks={paged.items}
            pid={rowPid}
            selectedId={selected?.id ?? null}
            onSelect={select}
            onEdit={(task) => setEditing({ pid: rowPid(task), task })}
            onChanged={() => paged.mutate()}
            checkedIds={checkedIds}
            onToggleCheck={toggleCheck}
            footer={
              <Pager
                page={paged.page}
                pageCount={paged.pageCount}
                total={paged.total}
                start={paged.start}
                end={paged.end}
                pageSize={paged.pageSize}
                onPage={paged.setPage}
                onPageSize={paged.setPageSize}
              />
            }
          />
          <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
            {selected ? (
              <TaskDetail
                key={`${rowPid(selected)}-${selected.id}`}
                pid={rowPid(selected)}
                taskId={selected.id}
                projectName={pid ? undefined : (selected as GlobalTaskEntry).project_name}
                onEdit={(task) => setEditing({ pid: rowPid(selected), task })}
                onChanged={() => paged.mutate()}
              />
            ) : (
              <Empty fill icon={MousePointerClick}>{t("tasks.detail_empty")}</Empty>
            )}
          </div>
        </div>
      )}

      <TaskFormDialog
        open={adding || !!editing}
        onClose={() => { setAdding(false); setEditing(null); }}
        fixedPid={pid}
        projects={projects}
        editing={editing}
        onSaved={() => paged.mutate()}
      />

      <BulkActionBar
        count={checked.size}
        onDone={() => setBulk("done")}
        onDrop={() => setBulk("drop")}
        onClear={clearChecked}
      />
      <ConfirmDialog
        open={bulk === "done"}
        onClose={() => setBulk(null)}
        onConfirm={() => runBulk("done")}
        destructive={false}
        title={t("tasks.confirm_bulk_done_title", { count: checked.size })}
        description={t("tasks.confirm_bulk_done_desc", { count: checked.size })}
        confirmLabel={t("tasks.bulk_done")}
        testId="task-bulk-done-confirm"
      />
      <ConfirmDialog
        open={bulk === "drop"}
        onClose={() => setBulk(null)}
        onConfirm={() => runBulk("drop")}
        title={t("tasks.confirm_bulk_drop_title", { count: checked.size })}
        description={t("tasks.confirm_bulk_drop_desc", { count: checked.size })}
        confirmLabel={t("tasks.bulk_drop")}
        testId="task-bulk-drop-confirm"
      />
    </Section>
  );
}
