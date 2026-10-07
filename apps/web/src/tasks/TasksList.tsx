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
import { useEffect, useMemo, useState } from "react";
import { dueLabel, shortWhen } from "../common/format.ts";
import { useLongPressDrag } from "../common/useLongPressDrag.ts";
import { blobOf, DEFAULT_PID, projectName, projectTone } from "../data/identity.ts";
import { useData } from "../data/state.ts";
import { loadTasks, useTasks } from "../data/tasks.ts";
import { type MessageKey, type T, useT } from "../i18n/index.ts";
import { nav, useNav } from "../shell/nav.ts";
import { CommitmentMeta } from "./Commitments.tsx";
import { kindLabel, PriorityDot } from "./TaskFields.tsx";
import { NewTask } from "./TaskForms.tsx";
import { TaskPanel } from "./TaskPanel.tsx";
import { dropOn, taskMenu } from "./taskActions.tsx";
import { GROUP_ORDER, type GroupId, groupTasks } from "./taskGroups.ts";

const LIVE: ReadonlySet<Run["state"]> = new Set(["submitted", "working"]);
/** How many tasks each group shows globally before "See n more". */
const GLOBAL_PEEK = 5;

const GROUP_LABEL: Record<GroupId, MessageKey> = {
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
  useEffect(() => {
    void loadTasks();
  }, []);
  const global = !projectId;

  const scoped = useMemo(
    () =>
      Object.values(all).filter(
        (x) => !projectId || (projectId === DEFAULT_PID ? !x.project_id : x.project_id === projectId),
      ),
    [all, projectId],
  );
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
  const filled = groupTasks(shown, running);
  // While dragging every group is a place to drop, empty ones too.
  const groups = drag ? GROUP_ORDER.map((id) => filled.find((g) => g.id === id) ?? { id, items: [] }) : filled;
  // Only a task of this list opens beside it (a project's tab never shows another project's task).
  const current = open ? scoped.find((x) => x.id === open) : undefined;

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
                </header>
                <ul className="tasks__rows">
                  {items.map((task) => (
                    <TaskRow
                      key={task.id}
                      task={task}
                      group={g.id}
                      running={running.has(task.thread_id)}
                      showProject={global}
                      selected={task.id === open}
                      dragging={drag?.item.id === task.id}
                      drag={bind(task, task.title)}
                      onOpen={() => setOpen(task.id === open ? undefined : task.id)}
                    />
                  ))}
                </ul>
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
    </div>
  );
}

function TaskRow(props: {
  task: Task;
  group: GroupId;
  running: boolean;
  showProject: boolean;
  selected: boolean;
  dragging: boolean;
  drag: ReturnType<ReturnType<typeof useLongPressDrag<Task>>["bind"]>;
  onOpen(): void;
}) {
  const t = useT();
  const { task } = props;
  const agents = useData((s) => s.agents);
  const columns = useTasks((s) => s.columns);
  const projects = useData((s) => s.projects);
  const who = task.assignee ? agents[task.assignee] : undefined;
  const due = task.due_at ? dueLabel(task.due_at) : undefined;
  const pid = task.project_id ?? DEFAULT_PID;
  return (
    <li>
      <ContextMenu items={taskMenu(task, { t, columns, agents: Object.values(agents), onOpen: props.onOpen })}>
        <button
          type="button"
          className={`taskrow${props.showProject ? "" : " taskrow--local"}${props.selected ? " is-selected" : ""}${props.dragging ? " is-dragging" : ""}${task.state === "dropped" ? " is-dropped" : ""}`}
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
              {task.state !== "open" && closedLabel(task, t) && (
                <span className={`taskrow__closed is-${task.state}`}>{closedLabel(task, t)}</span>
              )}
              {task.kind !== "task" && (
                <span className={`taskrow__commit is-${task.kind}`}>
                  {task.kind === "commitment" ? <Icons.Calendar size={11} /> : <Icons.MapPin size={11} />}
                  {kindLabel(task.kind, t)}
                </span>
              )}
            </span>
            {(task.person_id || task.tags.length > 0) && (
              <span className="taskrow__sub">
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
