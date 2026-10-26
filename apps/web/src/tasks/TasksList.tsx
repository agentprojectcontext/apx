import type { Run, Task } from "@apx/protocol";
import {
  AgentAvatar,
  Button,
  ContextMenu,
  EmptyState,
  Help,
  Icons,
  ProjectTile,
  SegmentedControl,
  Spinner,
} from "@apx/ui";
import { type CSSProperties, type ReactNode, useEffect, useMemo, useState } from "react";
import { aheadLabel, dueLabel, shortWhen } from "../common/format.ts";
import { SearchSelect } from "../common/pickers/SearchSelect.tsx";
import { useLongPressDrag } from "../common/useLongPressDrag.ts";
import {
  blobOf,
  DEFAULT_PID,
  inProject,
  projectEntries,
  projectInitial,
  projectName,
  projectTone,
} from "../data/identity.ts";
import { setPrefs, usePrefs } from "../data/prefs.ts";
import { useData } from "../data/state.ts";
import { taskChatIds } from "../data/taskChats.ts";
import { acceptTasks, loadTasks, useTasks } from "../data/tasks.ts";
import { type MessageKey, type T, useT } from "../i18n/index.ts";
import { nav, useNav } from "../shell/nav.ts";
import { CommitmentMeta } from "./Commitments.tsx";
import { kindLabel, PriorityDot } from "./TaskFields.tsx";
import { DeleteTask, NewTask } from "./TaskForms.tsx";
import { TaskPanel } from "./TaskPanel.tsx";
import { dropOn, taskMenu } from "./taskActions.tsx";
import { GROUP_ORDER, type GroupId, groupOf, groupTasks, nestTasks } from "./taskGroups.ts";

/** A task is being worked while one of these runs: a delegation queued for a slot is work taken on too. */
const LIVE: ReadonlySet<Run["state"]> = new Set(["queued", "submitted", "working"]);
/** The project filter's value for every project (a nav project id never is empty). */
const ALL_PROJECTS = "";
/** How many tasks each group shows globally before "See n more". */
const GLOBAL_PEEK = 5;
/** How deep subtasks indent; deeper ones line up with the last level. */
const MAX_DEPTH = 3;

const GROUP_LABEL: Record<GroupId, MessageKey> = {
  proposed: "tasks.group.proposed",
  doing: "tasks.group.doing",
  pending: "tasks.group.pending",
  review: "tasks.group.review",
  blocked: "tasks.group.blocked",
  closed: "tasks.group.closed",
};

/** How a closed task ended, when a check alone does not say it: dropped, or a commitment's outcome. */
function closedLabel(task: Task, t: T): string | undefined {
  if (task.kind === "commitment" && task.outcome) return t(`tasks.outcome.${task.outcome}`);
  return task.state === "dropped" ? t("tasks.dropped") : undefined;
}

/** What puts a task in each group of the list. */
export function GroupsHelp() {
  const t = useT();
  return (
    <Help
      label={t("tasks.help.groups")}
      title={t("tasks.help.groupsTitle")}
      className="taskhelp__title"
      items={GROUP_ORDER.map((g) => ({ term: t(GROUP_LABEL[g]), text: t(`tasks.help.group.${g}`) }))}
    />
  );
}

type Kind = "all" | "task" | "commitment" | "errand";
const FILTERS: readonly Kind[] = ["all", "task", "commitment", "errand"];
const FILTER_LABEL: Record<Kind, MessageKey> = {
  all: "tasks.kind.all",
  task: "tasks.kind.tasks",
  commitment: "tasks.kind.commitments",
  errand: "tasks.kind.errands",
};

/**
 * Tasks as one list grouped by where they stand, not a board: in progress on top, then pending, in review and
 * blocked; the recently closed ones folded at the end. Globally every project's (5 per group, with the project
 * column); inside a project only its own, all of them.
 */
export function TasksList({
  projectId,
  creating,
  setCreating,
}: {
  projectId?: string;
  creating: boolean;
  setCreating(on: boolean): void;
}) {
  const t = useT();
  const all = useTasks((s) => s.tasks);
  const ready = useTasks((s) => s.ready);
  const runs = useData((s) => s.runs);
  const [kind, setKind] = useState<Kind>("all");
  const open = useNav((s) => s.taskId);
  const setOpen = (taskId: string | undefined) => nav.set({ taskId });
  const [more, setMore] = useState<Set<GroupId>>(new Set());
  const [closedOpen, setClosedOpen] = useState(false);
  const [deleting, setDeleting] = useState<Task>();
  const [folded, setFolded] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => {
    void loadTasks();
  }, []);
  const global = !projectId;
  const projects = useData((s) => s.projects);
  const picked = usePrefs((s) => s.tasksProject);
  // A remembered project that was removed since falls back to every project.
  const filter =
    global && picked !== ALL_PROJECTS && projectEntries(projects).some((p) => p.id === picked) ? picked : undefined;
  const scope = projectId ?? filter;

  const scoped = useMemo(() => Object.values(all).filter((x) => !scope || inProject(x, scope)), [all, scope]);
  const counts: Record<Kind, number> = {
    all: scoped.length,
    task: scoped.filter((x) => x.kind === "task").length,
    commitment: scoped.filter((x) => x.kind === "commitment").length,
    errand: scoped.filter((x) => x.kind === "errand").length,
  };
  const shown = scoped.filter((x) => kind === "all" || x.kind === kind);
  const threads = useData((s) => s.threads);
  // A task is being worked while a turn runs in one of its agents' chats (or, from before, in its own thread).
  const running = useMemo(() => {
    const live = Object.values(runs).flatMap((r) => (LIVE.has(r.state) ? [r.thread_id] : []));
    const tasks = new Set(live.flatMap((id) => threads[id]?.task_id ?? []));
    return new Set([...live, ...Object.values(all).flatMap((x) => (tasks.has(x.id) ? [x.thread_id] : []))]);
  }, [runs, threads, all]);
  const columns = useTasks((s) => s.columns);
  const { drag, bind } = useLongPressDrag<Task>((task, target) => void dropOn(task, target as GroupId, columns));
  // Subtasks sit under their parent, whatever group they are in; only the tasks at the top are grouped.
  const { top, children } = useMemo(() => nestTasks(shown), [shown]);
  const filled = groupTasks(top, running);
  // While dragging every group is a place to drop, empty ones too.
  const groups = drag ? GROUP_ORDER.map((id) => filled.find((g) => g.id === id) ?? { id, items: [] }) : filled;
  // Only a task of this list opens beside it (a project's tab never shows another project's task).
  const current = open ? scoped.find((x) => x.id === open) : undefined;
  /** A task's row, then its subtasks' rows under it (while unfolded), indented a level each. */
  const branch = (task: Task, group: GroupId, depth: number): ReactNode[] => {
    const subs = children.get(task.id) ?? [];
    const shut = folded.has(task.id);
    const toggle = () =>
      setFolded((f) => {
        const next = new Set(f);
        if (!next.delete(task.id)) next.add(task.id);
        return next;
      });
    return [
      <TaskRow
        key={task.id}
        task={task}
        group={group}
        depth={Math.min(depth, MAX_DEPTH)}
        subtasks={
          subs.length
            ? { done: subs.filter((s) => s.state !== "open").length, total: subs.length, shut, toggle }
            : undefined
        }
        running={running.has(task.thread_id)}
        showProject={global && !filter}
        selected={task.id === open}
        dragging={drag?.item.id === task.id}
        drag={bind(task, task.title)}
        onOpen={() => setOpen(task.id === open ? undefined : task.id)}
        onDelete={() => setDeleting(task)}
      />,
      ...(shut ? [] : subs.flatMap((s) => branch(s, groupOf(s, running), depth + 1))),
    ];
  };

  return (
    <div className={current ? "tasks has-panel" : "tasks"}>
      <div className="tasks__main">
        <div className="tasks__bar">
          <SegmentedControl
            size="sm"
            label={t("tasks.show")}
            value={kind}
            onValueChange={(v) => setKind(v as Kind)}
            options={FILTERS.map((k) => ({
              value: k,
              label: (
                <span className="resv__tab">
                  {t(FILTER_LABEL[k])}
                  <span className="resv__count">{counts[k]}</span>
                </span>
              ),
            }))}
          />
          {global && (
            <SearchSelect
              label={t("pickers.project")}
              searchPlaceholder={t("pickers.searchProject")}
              emptyLabel={t("pickers.noMatch")}
              size="sm"
              className="tasks__project"
              value={filter ?? ALL_PROJECTS}
              onValueChange={(v) => setPrefs({ tasksProject: v ?? ALL_PROJECTS })}
              options={[
                { value: ALL_PROJECTS, label: t("tasks.allProjects"), icon: <Icons.Layers size={14} /> },
                ...projectEntries(projects).map((p) => ({
                  value: p.id,
                  label: p.name,
                  icon: <ProjectTile tone={projectTone(p.id)} initial={projectInitial(p.name)} size={16} />,
                })),
              ]}
            />
          )}
          <span className="board__spacer" />
          {!global && (
            <Button size="sm" leadingIcon={<Icons.Plus size={14} />} onClick={() => setCreating(true)}>
              {t("tasks.new")}
            </Button>
          )}
        </div>
        {ready && !shown.length ? (
          <EmptyState variant="dashed" size="lg" icon={<Icons.ListChecks />} title={t("tasks.emptyTitle")}>
            {t("tasks.empty")}
          </EmptyState>
        ) : (
          groups.map((g) => {
            const folded = g.id === "closed" && !closedOpen && !drag;
            const limit = global && !more.has(g.id) ? GLOBAL_PEEK : Number.POSITIVE_INFINITY;
            const items = folded ? [] : g.items.slice(0, limit);
            const hidden = folded ? 0 : g.items.length - items.length;
            return (
              <section
                key={g.id}
                className={`tasks__group is-${g.id}${drag ? " is-droppable" : ""}${drag?.over === g.id ? " is-over" : ""}`}
                aria-label={t(GROUP_LABEL[g.id])}
                data-drop={g.id}
              >
                <header className="tasks__grouphead">
                  {g.id === "closed" ? (
                    <button
                      type="button"
                      className="tasks__fold"
                      aria-expanded={closedOpen}
                      onClick={() => setClosedOpen((o) => !o)}
                    >
                      <Icons.ChevronRight size={14} className={closedOpen ? "is-open" : undefined} />
                      {t(GROUP_LABEL[g.id])}
                    </button>
                  ) : (
                    <>
                      <span className="tasks__groupdot" />
                      {t(GROUP_LABEL[g.id])}
                    </>
                  )}
                  <span className="tasks__groupcount">{g.items.length}</span>
                  {g.id === "proposed" && (
                    <Button size="sm" variant="ghost" onClick={() => void acceptTasks(g.items.map((x) => x.id))}>
                      {t("tasks.acceptAll")}
                    </Button>
                  )}
                  <Help label={t(GROUP_LABEL[g.id])} align="start" width={280}>
                    {t(`tasks.help.group.${g.id}`)}
                  </Help>
                </header>
                <ul className="tasks__rows">{items.flatMap((task) => branch(task, g.id, 0))}</ul>
                {hidden > 0 && (
                  <button type="button" className="tasks__more" onClick={() => setMore((m) => new Set([...m, g.id]))}>
                    {t("tasks.seeMore", { n: hidden })}
                  </button>
                )}
              </section>
            );
          })
        )}
      </div>
      {drag && (
        <div className="taskdrag" style={{ left: drag.x + 12, top: drag.y + 8 }} aria-hidden="true">
          <Icons.ListChecks size={14} />
          {drag.label}
        </div>
      )}
      {current && <TaskPanel key={current.id} task={current} onClose={() => setOpen(undefined)} />}
      {creating && <NewTask projectId={projectId} onClose={() => setCreating(false)} />}
      {deleting && <DeleteTask task={deleting} onClose={() => setDeleting(undefined)} />}
    </div>
  );
}

function TaskRow(props: {
  task: Task;
  group: GroupId;
  /** 0 at the top; a subtask is one more than its parent. */
  depth: number;
  /** Its subtasks: how many are closed, and folding them away. */
  subtasks: { done: number; total: number; shut: boolean; toggle(): void } | undefined;
  running: boolean;
  showProject: boolean;
  selected: boolean;
  dragging: boolean;
  drag: ReturnType<ReturnType<typeof useLongPressDrag<Task>>["bind"]>;
  onOpen(): void;
  onDelete(): void;
}) {
  const t = useT();
  const { task } = props;
  const archived = useData((s) => {
    const ids = new Set(taskChatIds(task, Object.values(s.threads)));
    const chats = Object.values(s.threads).filter((th) => ids.has(th.id));
    return chats.length > 0 && chats.every((th) => th.archived);
  });
  const agents = useData((s) => s.agents);
  const columns = useTasks((s) => s.columns);
  const projects = useData((s) => s.projects);
  const who = task.assignee ? agents[task.assignee] : undefined;
  const due = task.due_at ? dueLabel(task.due_at) : undefined;
  // In review it says who checks it; assigned with a start still ahead, when its work begins.
  const reviewing = task.state === "open" && task.status === "review";
  // A reviewer since removed reads as the owner, who checks it then; never a raw id.
  const reviewerName = (task.reviewer && agents[task.reviewer]?.name) || t("tasks.reviewerOwner");
  const startsAt =
    task.state === "open" && task.start_at && task.start_at > new Date().toISOString() ? task.start_at : undefined;
  const pid = task.project_id ?? DEFAULT_PID;
  const subs = props.subtasks;
  return (
    <li className="tasks__item" style={{ "--depth": props.depth } as CSSProperties}>
      {subs && (
        <button
          type="button"
          className="tasks__subfold"
          aria-expanded={!subs.shut}
          aria-label={t(subs.shut ? "tasks.subtasks.show" : "tasks.subtasks.hide", { title: task.title })}
          onClick={subs.toggle}
        >
          <Icons.ChevronRight size={12} className={subs.shut ? undefined : "is-open"} />
        </button>
      )}
      <ContextMenu
        items={taskMenu(task, {
          t,
          columns,
          agents: Object.values(agents),
          archived,
          onOpen: props.onOpen,
          onDelete: props.onDelete,
        })}
      >
        <button
          type="button"
          className={`taskrow${props.showProject ? "" : " taskrow--local"}${props.selected ? " is-selected" : ""}${props.dragging ? " is-dragging" : ""}${task.state === "dropped" ? " is-dropped" : ""}${props.depth && task.state !== "open" ? " is-subclosed" : ""}`}
          aria-current={props.selected || undefined}
          onClick={props.onOpen}
          {...props.drag}
        >
          <span
            className={`taskrow__glyph is-${props.group}`}
            title={props.group === "blocked" ? t("tasks.blockedTip") : undefined}
          >
            {props.running && props.group === "doing" ? (
              <Spinner size={12} />
            ) : props.group === "closed" ? (
              task.state === "dropped" ? (
                <Icons.X size={12} />
              ) : (
                <Icons.Check size={12} />
              )
            ) : null}
          </span>
          <span className="taskrow__main">
            <span className="taskrow__title">
              {task.priority !== "normal" && task.state === "open" && <PriorityDot priority={task.priority} />}
              <span className="taskrow__name">{task.title}</span>
              {subs && (
                <span className="taskrow__subs" title={t("tasks.subtasks.count", { done: subs.done, n: subs.total })}>
                  <Icons.ListChecks size={11} />
                  {subs.done}/{subs.total}
                </span>
              )}
              {task.state !== "open" && closedLabel(task, t) && (
                <span className={`taskrow__closed is-${task.state}`}>{closedLabel(task, t)}</span>
              )}
            </span>
            {/* Every mark goes on one line under the title, side by side: kind, who it is with, date, tags. */}
            {(task.kind !== "task" ||
              task.person_id ||
              task.tags.length > 0 ||
              reviewing ||
              startsAt ||
              task.awaits_owner ||
              task.proposed) && (
              <span className="taskrow__sub">
                {task.proposed && task.state === "open" ? (
                  <span className="taskrow__commit">
                    <Icons.Sparkles size={11} />
                    {agents[task.created_by]
                      ? t("tasks.row.proposedBy", { name: agents[task.created_by]?.name ?? "" })
                      : t("tasks.row.proposed")}
                  </span>
                ) : task.awaits_owner && task.state === "open" ? (
                  <span className="taskrow__commit">
                    <Icons.MessageCircle size={11} />
                    {t("tasks.row.asks")}
                  </span>
                ) : (
                  reviewing && (
                    <span className="taskrow__commit">
                      <Icons.Eye size={11} />
                      {t("tasks.row.reviewer", { name: reviewerName })}
                    </span>
                  )
                )}
                {startsAt && (
                  <span className="taskrow__commit">
                    <Icons.Clock size={11} />
                    {t("tasks.row.starts", { when: aheadLabel(startsAt) })}
                  </span>
                )}
                {task.kind !== "task" && (
                  <span className={`taskrow__commit is-${task.kind}`}>
                    {task.kind === "commitment" ? <Icons.Calendar size={11} /> : <Icons.MapPin size={11} />}
                    {kindLabel(task.kind, t)}
                  </span>
                )}
                {task.person_id && <CommitmentMeta task={task} />}
                {task.tags.slice(0, 3).map((tag) => (
                  <span key={tag} className="taskrow__tag">
                    <Icons.Tag size={10} />
                    {tag}
                  </span>
                ))}
              </span>
            )}
          </span>
          {props.showProject && (
            <span className="taskrow__project">
              <ProjectTile
                tone={projectTone(pid)}
                initial={projectName(projects, task.project_id).slice(0, 1)}
                size={14}
              />
              {projectName(projects, task.project_id)}
            </span>
          )}
          <span className="taskrow__who">
            {who ? (
              <>
                <AgentAvatar name={who.name} blob={blobOf(who)} size={18} animated={false} />
                {who.name}
              </>
            ) : (
              <span className="taskrow__nobody">{t("tasks.nobody")}</span>
            )}
            {task.chats > 0 && (
              <span className="taskrow__chats" title={t("tasks.chats", { n: String(task.chats) })}>
                {props.running ? <Spinner size={10} /> : <Icons.MessagesSquare size={11} />}
                {task.chats}
              </span>
            )}
          </span>
          <span className={due?.late && task.state === "open" ? "taskrow__when is-late" : "taskrow__when"}>
            {due ? due.text : shortWhen(task.activity_at)}
          </span>
        </button>
      </ContextMenu>
    </li>
  );
}

/** A project's Tasks tab: only its own tasks, all of them, with its own "New task". */
export function ProjectTasks({ projectId }: { projectId: string }) {
  const [creating, setCreating] = useState(false);
  return <TasksList projectId={projectId} creating={creating} setCreating={setCreating} />;
}
