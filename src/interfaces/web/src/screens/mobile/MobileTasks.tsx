import { useMemo, useState } from "react";
import useSWR from "swr";
import { Check, ExternalLink, ListTodo, RotateCcw, Trash2 } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "../../components/ui/sheet";
import { StatusBadge, StatusIcon, effectiveStatus, statusTint } from "../../components/tasks/taskStatus";
import { useToast } from "../../components/Toast";
import { Loading } from "../../components/ui";
import { Tasks, type GlobalTaskEntry } from "../../lib/api/tasks";
import { DueChip, MobileChip, MobileGroupHeader, MobileListHeader, dueBucketLabel, groupByDue } from "./mobileList";
import { cn } from "../../lib/cn";
import { t } from "../../i18n";

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
                <TaskRow key={`${task.project_id}-${task.id}`} task={task} onOpen={() => setOpen(task)} />
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

      <TaskSheet task={open} onClose={() => setOpen(null)} onChanged={() => void mutate()} />
    </div>
  );
}

function TaskRow({ task, onOpen }: { task: GlobalTaskEntry; onOpen: () => void }) {
  const eff = effectiveStatus(task);
  const day = task.due ? String(task.due).slice(0, 10) : null;
  const late = task.state === "open" && !!day && day < new Date().toISOString().slice(0, 10);
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        data-testid={`mobile-task-${task.id}`}
        className="flex w-full items-start gap-3 px-4 py-3 text-left active:bg-accent/50"
      >
        <span className={cn("mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg", statusTint(eff))}>
          <StatusIcon status={eff} className="size-4" />
        </span>
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
    </li>
  );
}

/**
 * One task, opened from the list.
 *
 * A sheet and not a route: on a phone the list is the place, and the verbs
 * (done / reopen / drop) are the whole reason to open a task at all. Sending
 * you to a second screen for one tap costs a back gesture and your scroll.
 */
function TaskSheet({
  task, onClose, onChanged,
}: {
  task: GlobalTaskEntry | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  if (!task) return null;
  const pid = String(task.project_id);

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

  return (
    <Sheet open onOpenChange={(v) => { if (!v) onClose(); }}>
      <SheetContent side="bottom" className="max-h-[85vh] gap-0 rounded-t-2xl p-0" data-testid="mobile-task-sheet">
        <SheetHeader className="gap-2 border-b border-border px-4 pb-3 pt-4">
          <SheetTitle className="pr-8 text-left text-base leading-snug">{task.title}</SheetTitle>
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={effectiveStatus(task)} />
            {task.due && (
              <span className="text-[11px] text-muted-fg">
                {t("project.tasks.due")} {String(task.due).slice(0, 10)}
              </span>
            )}
          </div>
        </SheetHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 text-sm">
          {task.body && <p className="whitespace-pre-wrap [overflow-wrap:anywhere]">{task.body}</p>}
          {!task.body && <p className="text-muted-fg">{t("project.tasks.add_placeholder")}</p>}
          {!!task.tags?.length && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {task.tags.map((tag) => (
                <span key={tag} className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-fg">
                  {tag}
                </span>
              ))}
            </div>
          )}
          <dl className="mt-4 space-y-1.5 text-xs text-muted-fg">
            <Field label={t("nav.project")} value={task.project_name} />
            <Field label={t("tasks.field_agent")} value={task.agent || t("tasks.agent_none_short")} />
            <Field label={t("tasks.field_created")} value={task.created_at?.slice(0, 16).replace("T", " ")} />
          </dl>
        </div>

        <div className="flex shrink-0 gap-2 border-t border-border px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3">
          {task.state === "open" ? (
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
          {/* The panel, for everything this sheet deliberately does not do:
              editing the prompt, reassigning the agent, reading the thread. */}
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
