import { useMemo, useState } from "react";
import useSWR from "swr";
import { Check, ExternalLink, ListTodo, Pencil, RotateCcw, Trash2 } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "../../components/ui/sheet";
import { StatusBadge, StatusIcon, effectiveStatus, statusTint } from "../../components/tasks/taskStatus";
import { useToast } from "../../components/Toast";
import { Loading } from "../../components/ui";
import { UiSelect } from "../../components/UiSelect";
import { Tasks, type GlobalTaskEntry } from "../../lib/api/tasks";
import { Agents } from "../../lib/api/agents";
import { TaskComments } from "../../components/tasks/TaskComments";
import { TaskSubtasks } from "../../components/tasks/TaskSubtasks";
import { TaskFormDialog } from "../../components/tasks/TaskFormDialog";
import { assigneeOptions, priorityOptions, reminderOptions } from "../../components/tasks/taskFields";
import { useTaskColumns } from "../../components/tasks/useTaskColumns";
import { columnLabel } from "../../components/tasks/columns";
import { useProjects } from "../../hooks/useProjects";
import {
  DueChip, MobileChip, MobileGroupHeader, MobileListHeader, MobileNewButton,
  SwipeAction, SwipeRow, dueBucketLabel, groupByDue,
} from "./mobileList";
import { cn } from "../../lib/cn";
import { t } from "../../i18n";
import type { TaskEntry, TaskStatus } from "../../types/daemon";

type State = "open" | "done" | "dropped" | "all";
const STATES: State[] = ["open", "done", "dropped", "all"];

/** One request per screenful. Raised, not offset, by "load more" — see below. */
const PAGE = 50;

/** Stable identity for "nothing yet", so the memos below can actually memo. */
const NONE: GlobalTaskEntry[] = [];

/**
 * Every task, every project, on the phone.
 *
 * Cross-project on purpose and without a project picker: the panel's task list
 * hangs off a project because that is where tasks are stored, but nobody
 * standing in a queue thinks "let me check repo 7". They think "what do I owe
 * today", and the answer spans everything.
 *
 * So the grouping is by WHEN, not by where. The project is a caption on the
 * row, which is all it needs to be once the date is doing the sorting.
 */
export function MobileTasks() {
  const [state, setState] = useState<State>("open");
  const [query, setQuery] = useState("");
  const [pages, setPages] = useState(1);
  const [open, setOpen] = useState<GlobalTaskEntry | null>(null);
  // Writing one down, and fixing one. The same dialog the panel uses — a second
  // form for the phone is two places for "what a task can have" to disagree.
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<{ pid: string; task: TaskEntry } | null>(null);
  const { projects } = useProjects();

  const limit = PAGE * pages;
  const { data, isLoading, mutate } = useSWR(
    `mobile-tasks:${state}:${limit}`,
    () => Tasks.globalPage({ state, limit, offset: 0 }),
    { revalidateOnFocus: true, keepPreviousData: true },
  );
  const items = data?.items ?? NONE;
  const total = data?.total ?? 0;

  const q = query.trim().toLowerCase();
  const shown = useMemo(() => {
    if (!q) return items;
    return items.filter((task) =>
      [task.title, task.body, task.project_name, task.agent, ...(task.tags || [])]
        .some((f) => String(f || "").toLowerCase().includes(q)),
    );
  }, [items, q]);

  // "Vencida" is about work still owed. On the done/dropped lists the date has
  // stopped being a deadline, so the buckets go away and the server's order
  // (newest first) stands.
  const groups = useMemo(
    () => groupByDue(shown, (task) => task.due, { keep: state === "open" }),
    [shown, state],
  );

  const changeState = (next: State) => {
    setState(next);
    setPages(1);
  };

  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden">
      <MobileListHeader
        title={t("mobile.tab_tasks")}
        query={query}
        onQuery={setQuery}
        searchPlaceholder={t("mobile.tasks_search")}
        actions={
          <MobileNewButton
            label={t("mobile.new_task")}
            testId="mobile-task-new"
            onClick={() => setAdding(true)}
          />
        }
        filters={STATES.map((s) => (
          <MobileChip
            key={s}
            active={state === s}
            onClick={() => changeState(s)}
            testId={`mobile-task-filter-${s}`}
          >
            {s === "all" ? t("project.commitments.state.all") : t(`tasks.state_${s}` as never)}
          </MobileChip>
        ))}
      />

      <div className="min-h-0 flex-1 overflow-y-auto" data-testid="mobile-task-list">
        {isLoading && !data && <div className="py-10"><Loading /></div>}

        {!isLoading && shown.length === 0 && (
          <p className="px-4 py-16 text-center text-sm text-muted-fg">
            <ListTodo size={20} className="mx-auto mb-2 opacity-50" />
            {q ? t("inbox.no_match") : t("project.tasks.empty_open")}
          </p>
        )}

        {groups.map((group) => (
          <section key={group.bucket ?? "all"}>
            {group.bucket && (
              <MobileGroupHeader label={dueBucketLabel(group.bucket)} count={group.rows.length} />
            )}
            <ul className="divide-y divide-border/60">
              {group.rows.map((task) => (
                <TaskRow
                  key={`${task.project_id}-${task.id}`}
                  task={task}
                  onOpen={() => setOpen(task)}
                  onChanged={() => void mutate()}
                />
              ))}
            </ul>
          </section>
        ))}

        {/* Raising the limit rather than appending a page: these lists are tens
            of rows, the grouping has to see all of them to be honest about
            "vencidas", and one query that returns the truth beats a merged
            cache that can hold the same task twice. */}
        {items.length < total && (
          <button
            type="button"
            onClick={() => setPages((n) => n + 1)}
            data-testid="mobile-tasks-more"
            className="w-full py-4 text-center text-sm font-medium text-primary active:bg-accent/50"
          >
            {t("mobile.load_more", { count: total - items.length })}
          </button>
        )}
        <div className="h-4" />
      </div>

      <TaskSheet
        task={open}
        onClose={() => setOpen(null)}
        onChanged={() => void mutate()}
        onEdit={(pid, task) => { setOpen(null); setEditing({ pid, task }); }}
      />

      <TaskFormDialog
        open={adding || !!editing}
        onClose={() => { setAdding(false); setEditing(null); }}
        projects={projects}
        editing={editing}
        onSaved={() => void mutate()}
      />
    </div>
  );
}

/**
 * A row you can tick off without opening it.
 *
 * The sheet has always carried the verbs, and that was one tap too many for
 * the commonest one: on a phone, "done" is what you do while walking, and
 * open-sheet-find-button-tap is not that. The status square is the target now,
 * padded out to a thumb, and undo rides the toast.
 *
 * Pushing the row aside gets you the other verb — dropping it — without the
 * sheet either. Tapping still opens the sheet, which is where everything else
 * about a task lives.
 */
function TaskRow({ task, onOpen, onChanged }: {
  task: GlobalTaskEntry;
  onOpen: () => void;
  onChanged: () => void;
}) {
  const toast = useToast();
  const eff = effectiveStatus(task);
  const day = task.due ? String(task.due).slice(0, 10) : null;
  const late = task.state === "open" && !!day && day < new Date().toISOString().slice(0, 10);
  const pid = String(task.project_id);
  const isOpen = task.state === "open";

  /** Run a verb, tell the list, and offer the way back. */
  const run = async (fn: () => Promise<unknown>, label: string, undo: () => Promise<unknown>) => {
    try {
      await fn();
      onChanged();
      toast.success(label, {
        label: t("tasks.undo"),
        onClick: () => {
          undo().then(onChanged).catch(() => toast.error(t("common.error_generic")));
        },
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.error_generic"));
    }
  };

  const tick = () => (isOpen
    ? run(() => Tasks.done(pid, task.id), t("project.tasks.done"), () => Tasks.reopen(pid, task.id))
    : run(() => Tasks.reopen(pid, task.id), t("project.tasks.reopen"), () => Tasks.done(pid, task.id)));

  return (
    <SwipeRow
      actions={(close) => (isOpen ? (
        <>
          <SwipeAction
            tone="done"
            icon={<Check size={18} />}
            label={t("mobile.swipe_done")}
            testId={`mobile-task-swipe-done-${task.id}`}
            onClick={() => { close(); void tick(); }}
          />
          <SwipeAction
            tone="drop"
            icon={<Trash2 size={18} />}
            label={t("mobile.swipe_drop")}
            testId={`mobile-task-swipe-drop-${task.id}`}
            onClick={() => {
              close();
              void run(
                () => Tasks.drop(pid, task.id),
                t("tasks.dropped_label"),
                () => Tasks.reopen(pid, task.id),
              );
            }}
          />
        </>
      ) : (
        <SwipeAction
          tone="done"
          icon={<RotateCcw size={18} />}
          label={t("mobile.swipe_reopen")}
          testId={`mobile-task-swipe-reopen-${task.id}`}
          onClick={() => { close(); void tick(); }}
        />
      ))}
    >
      {/* Its own control, outside the row button: a button inside a button is
          invalid, and this one has to win the tap. */}
      <button
        type="button"
        onClick={tick}
        data-testid={`mobile-task-tick-${task.id}`}
        aria-label={t(isOpen ? "tasks.tick_done" : "tasks.tick_reopen", { title: task.title })}
        className="shrink-0 py-3 pl-4 pr-3"
      >
        <span className={cn("mt-0.5 flex size-7 items-center justify-center rounded-lg", statusTint(eff))}>
          <StatusIcon status={eff} className="size-4" />
        </span>
      </button>
      <button
        type="button"
        onClick={onOpen}
        data-testid={`mobile-task-${task.id}`}
        className="flex min-w-0 flex-1 items-start py-3 pr-4 text-left"
      >
        <span className="min-w-0 flex-1">
          <span className="flex items-start gap-2">
            <span className={cn(
              "min-w-0 flex-1 text-[15px] leading-snug [overflow-wrap:anywhere]",
              task.state === "open" ? "font-medium" : "text-muted-fg line-through decoration-muted-fg/40",
            )}>
              {task.title}
            </span>
            <DueChip due={task.due} late={late} />
          </span>
          <span className="mt-0.5 block truncate text-xs text-muted-fg">
            {[task.project_name?.split("/").pop(), task.agent].filter(Boolean).join(" · ")}
          </span>
        </span>
      </button>
    </SwipeRow>
  );
}

/**
 * One task, opened from the list.
 *
 * A sheet and not a route: on a phone the list is the place, and the verbs
 * (done / reopen / drop) are the whole reason to open a task at all. Sending
 * you to a second screen for one tap costs a back gesture and your scroll.
 *
 * IT EDITS, IT DOES NOT ONLY DISPLAY. The four decisions you change from a
 * phone — where it is, who has it, how much it presses, whether it nags — are
 * pickers right here, the same ones the panel's detail shows. This used to be a
 * read-only card whose only way to change anything was a link to the desktop
 * panel, which on a phone is not a way.
 */
function TaskSheet({
  task, onClose, onChanged, onEdit,
}: {
  task: GlobalTaskEntry | null;
  onClose: () => void;
  onChanged: () => void;
  onEdit: (pid: string, task: TaskEntry) => void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const pid = task ? String(task.project_id) : "";
  // The list row does not carry the thread (rows count comments, they do not
  // ship them), so the sheet fetches the full task for its comments and
  // subtasks. Same endpoint the panel's detail uses.
  const { data: full, mutate: mutateFull } = useSWR(
    task ? `/api/projects/${pid}/tasks/${task.id}` : null,
    () => Tasks.get(pid, task!.id),
  );
  const { statuses } = useTaskColumns(task ? pid : undefined);
  const { data: agents } = useSWR(task ? `/api/projects/${pid}/agents` : null, () => Agents.list(pid));
  if (!task) return null;

  // The freshest copy wins: a picker that has just written a value must show
  // it, and the list row behind this sheet is a page old by then.
  const live = full ?? (task as TaskEntry);

  const act = async (fn: () => Promise<unknown>, label: string) => {
    setBusy(true);
    try {
      await fn();
      toast.success(label);
      onChanged();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.error_generic"));
    } finally {
      setBusy(false);
    }
  };

  /** A field edit: stays open, because you usually set two of them at once. */
  const edit = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      void mutateFull();
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.error_generic"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open onOpenChange={(v) => { if (!v) onClose(); }}>
      <SheetContent side="bottom" className="max-h-[85vh] gap-0 rounded-t-2xl p-0" data-testid="mobile-task-sheet">
        <SheetHeader className="gap-2 border-b border-border px-4 pb-3 pt-4">
          <SheetTitle className="pr-8 text-left text-base leading-snug">{task.title}</SheetTitle>
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={effectiveStatus(live)} />
            <span className="text-[11px] text-muted-fg">{task.project_name?.split("/").pop()}</span>
          </div>
        </SheetHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 text-sm">
          {/* The pickers first: they are why the sheet is open on a phone. */}
          {live.state === "open" && (
            <div className="grid grid-cols-2 gap-3">
              <SheetSelect label={t("tasks.field_status")} testId="mobile-task-status">
                <UiSelect
                  value={live.status ?? "pending"}
                  disabled={busy}
                  onChange={(v) => void edit(() => Tasks.status(pid, task.id, v as TaskStatus))}
                  options={statuses.map((c) => ({ value: c.id, label: columnLabel(c) }))}
                />
              </SheetSelect>
              <SheetSelect label={t("tasks.field_assignee")} testId="mobile-task-assignee">
                <UiSelect
                  value={live.agent ?? ""}
                  disabled={busy}
                  onChange={(v) => void edit(() => Tasks.patch(pid, task.id, { agent: v || null }))}
                  options={assigneeOptions(agents)}
                />
              </SheetSelect>
              <SheetSelect label={t("tasks.field_priority")} testId="mobile-task-priority">
                <UiSelect
                  value={live.priority ?? "normal"}
                  disabled={busy}
                  onChange={(v) => void edit(() => Tasks.patch(pid, task.id, { priority: v as TaskEntry["priority"] }))}
                  options={priorityOptions()}
                />
              </SheetSelect>
              <SheetSelect label={t("tasks.field_reminder")} testId="mobile-task-reminder">
                <UiSelect
                  value={live.reminder_frequency ?? "none"}
                  disabled={busy}
                  onChange={(v) => void edit(() => Tasks.patch(pid, task.id, { reminder_frequency: v as TaskEntry["reminder_frequency"] }))}
                  options={reminderOptions()}
                />
              </SheetSelect>
              {/* A date is a native picker on a phone — the one control here
                  that is genuinely better than its desktop version. */}
              <SheetSelect label={t("project.tasks.due")} testId="mobile-task-due">
                <input
                  type="date"
                  value={live.due ? String(live.due).slice(0, 10) : ""}
                  disabled={busy}
                  data-testid="mobile-task-due-input"
                  onChange={(e) => void edit(() => Tasks.patch(pid, task.id, { due: e.target.value || null }))}
                  className="h-9 w-full rounded-lg border border-border bg-background px-2 text-[13px] outline-none focus:border-primary/50"
                />
              </SheetSelect>
            </div>
          )}

          <div className="mt-4">
            {live.description
              ? <p className="whitespace-pre-wrap [overflow-wrap:anywhere]">{live.description}</p>
              : <p className="text-muted-fg">{t("tasks.description_empty")}</p>}
          </div>
          {live.body?.trim() ? (
            <p className="mt-3 whitespace-pre-wrap rounded-lg border border-border bg-muted/20 px-3 py-2 font-mono text-xs [overflow-wrap:anywhere]">
              {live.body}
            </p>
          ) : null}

          {/* The same two components the panel uses. A phone is where a comment
              actually gets written — you are away from the desk, you tag @qa,
              and it runs. Duplicating them for mobile would mean two threads
              that drift. */}
          <div className="mt-4 space-y-4">
            <TaskSubtasks
              pid={pid}
              taskId={task.id}
              onOpen={() => { /* the sheet IS the detail here — no second pane to move to */ }}
              onChanged={() => { void mutateFull(); onChanged(); }}
            />
            <TaskComments
              pid={pid}
              taskId={task.id}
              comments={full?.comments ?? []}
              onChanged={() => { void mutateFull(); onChanged(); }}
            />
          </div>
          {!!live.tags?.length && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {live.tags.map((tag) => (
                <span key={tag} className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-fg">
                  {tag}
                </span>
              ))}
            </div>
          )}
          <dl className="mt-4 space-y-1.5 text-xs text-muted-fg">
            <Field label={t("nav.project")} value={task.project_name} />
            <Field label={t("tasks.field_created")} value={task.created_at?.slice(0, 16).replace("T", " ")} />
          </dl>
        </div>

        <div className="flex shrink-0 gap-2 border-t border-border px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3">
          {live.state === "open" ? (
            <>
              <SheetAction
                icon={<Check size={16} />}
                label={t("tasks.mark_done")}
                primary
                busy={busy}
                testId="mobile-task-done"
                onClick={() => act(() => Tasks.done(pid, task.id), t("tasks.done_label"))}
              />
              <SheetAction
                icon={<Trash2 size={16} />}
                label={t("tasks.mark_dropped")}
                busy={busy}
                testId="mobile-task-drop"
                onClick={() => act(() => Tasks.drop(pid, task.id), t("tasks.dropped_label"))}
              />
            </>
          ) : (
            <SheetAction
              icon={<RotateCcw size={16} />}
              label={t("tasks.mark_reopen")}
              primary
              busy={busy}
              testId="mobile-task-reopen"
              onClick={() => act(() => Tasks.reopen(pid, task.id), t("tasks.state_open"))}
            />
          )}
          {/* The full form, for the fields that do not fit a sheet: the title,
              the two bodies, the tags, the place an errand happens. */}
          <button
            type="button"
            onClick={() => onEdit(pid, live)}
            aria-label={t("common.edit")}
            data-testid="mobile-task-edit"
            className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-border text-muted-fg active:bg-accent/60"
          >
            <Pencil size={16} />
          </button>
          <a
            href={`/p/${pid}/tasks?task=${encodeURIComponent(task.id)}`}
            target="_blank"
            rel="noopener"
            aria-label={t("inbox.open_in_project")}
            className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-border text-muted-fg active:bg-accent/60"
          >
            <ExternalLink size={16} />
          </a>
        </div>
      </SheetContent>
    </Sheet>
  );
}

/** One labelled picker in the sheet's grid. */
function SheetSelect({ label, children, testId }: {
  label: string;
  children: React.ReactNode;
  testId?: string;
}) {
  return (
    <div className="space-y-1" data-testid={testId}>
      <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-fg">{label}</div>
      {children}
    </div>
  );
}

function Field({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <div className="flex gap-2">
      <dt className="w-24 shrink-0">{label}</dt>
      <dd className="min-w-0 flex-1 truncate text-foreground">{value}</dd>
    </div>
  );
}

/** Full-width thumb target. Sheet verbs are the reason the sheet exists. */
export function SheetAction({
  icon, label, onClick, primary, busy, testId, tone,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  primary?: boolean;
  busy?: boolean;
  testId?: string;
  tone?: "danger";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      data-testid={testId}
      className={cn(
        "flex h-11 min-w-0 flex-1 items-center justify-center gap-2 rounded-xl text-sm font-medium disabled:opacity-50",
        primary
          ? "bg-primary text-primary-foreground active:bg-primary/90"
          : tone === "danger"
            ? "border border-red-600/40 text-red-700 active:bg-red-500/10 dark:text-red-400"
            : "border border-border text-foreground active:bg-accent/60",
      )}
    >
      {icon}
      <span className="truncate">{label}</span>
    </button>
  );
}
