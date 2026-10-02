import type { Run, Task } from "@apx/protocol";
import { AgentAvatar, Button, EmptyState, Icons, ProjectTile, SegmentedControl, Spinner } from "@apx/ui";
import { useEffect, useMemo, useState } from "react";
import { dueLabel, shortWhen } from "../common/format.ts";
import { blobOf, DEFAULT_PID, projectName, projectTone } from "../data/identity.ts";
import { useData } from "../data/state.ts";
import { loadTasks, useTasks } from "../data/tasks.ts";
import { type MessageKey, useT } from "../i18n/index.ts";
import { CommitmentMeta } from "./Commitments.tsx";
import { NewTask } from "./TaskForms.tsx";
import { TaskPanel } from "./TaskPanel.tsx";
import { type GroupId, groupTasks } from "./taskGroups.ts";

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

type Kind = "all" | "tasks" | "commitments";

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
  const [open, setOpen] = useState<string>();
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
  const counts = {
    all: scoped.length,
    tasks: scoped.filter((x) => !x.person_id).length,
    commitments: scoped.filter((x) => x.person_id).length,
  };
  const shown = scoped.filter((x) => (kind === "all" ? true : kind === "commitments" ? x.person_id : !x.person_id));
  const running = useMemo(
    () => new Set(Object.values(runs).flatMap((r) => (LIVE.has(r.state) ? [r.thread_id] : []))),
    [runs],
  );
  const groups = groupTasks(shown, running);
  const current = open ? all[open] : undefined;

  return (
    <div className={current ? "tasks has-panel" : "tasks"}>
      <div className="tasks__main">
        <div className="tasks__bar">
          <SegmentedControl
            size="sm"
            label={t("tasks.show")}
            value={kind}
            onValueChange={(v) => setKind(v as Kind)}
            options={(["all", "tasks", "commitments"] as const).map((k) => ({
              value: k,
              label: (
                <span className="resv__tab">
                  {t(`tasks.kind.${k}`)}
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
            const folded = g.id === "closed" && !closedOpen;
            const limit = global && !more.has(g.id) ? GLOBAL_PEEK : Number.POSITIVE_INFINITY;
            const items = folded ? [] : g.items.slice(0, limit);
            const hidden = folded ? 0 : g.items.length - items.length;
            return (
              <section key={g.id} className={`tasks__group is-${g.id}`} aria-label={t(GROUP_LABEL[g.id])}>
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
      {current && <TaskPanel task={current} onClose={() => setOpen(undefined)} />}
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
  onOpen(): void;
}) {
  const t = useT();
  const { task } = props;
  const agents = useData((s) => s.agents);
  const projects = useData((s) => s.projects);
  const who = task.assignee ? agents[task.assignee] : undefined;
  const due = task.due_at ? dueLabel(task.due_at) : undefined;
  const pid = task.project_id ?? DEFAULT_PID;
  return (
    <li>
      <button
        type="button"
        className={`taskrow${props.showProject ? "" : " taskrow--local"}${props.selected ? " is-selected" : ""}`}
        aria-current={props.selected || undefined}
        onClick={props.onOpen}
      >
        <span
          className={`taskrow__glyph is-${props.group}`}
          title={props.group === "blocked" ? t("tasks.blockedTip") : undefined}
        >
          {props.running && props.group === "doing" ? (
            <Spinner size={12} />
          ) : props.group === "closed" ? (
            <Icons.Check size={12} />
          ) : null}
        </span>
        <span className="taskrow__main">
          <span className="taskrow__title">
            {task.title}
            {task.person_id && (
              <span className="taskrow__commit">
                <Icons.Calendar size={11} />
                {t("tasks.commitment")}
              </span>
            )}
          </span>
          {task.person_id && (
            <span className="taskrow__sub">
              <CommitmentMeta task={task} />
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
        </span>
        <span className={due?.late && task.state === "open" ? "taskrow__when is-late" : "taskrow__when"}>
          {due ? due.text : shortWhen(task.activity_at)}
        </span>
      </button>
    </li>
  );
}

/** A project's Tasks tab: only its own tasks, all of them, with its own "New task". */
export function ProjectTasks({ projectId }: { projectId: string }) {
  const [creating, setCreating] = useState(false);
  return <TasksList projectId={projectId} creating={creating} setCreating={setCreating} />;
}
