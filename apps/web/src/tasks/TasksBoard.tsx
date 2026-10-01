import type { Task, TaskColumn, TaskEvent } from "@apx/protocol";
import {
  AgentAvatar,
  Badge,
  Button,
  Dialog,
  EmptyState,
  IconButton,
  Icons,
  Input,
  Menu,
  SegmentedControl,
  Textarea,
} from "@apx/ui";
import { useEffect, useMemo, useState } from "react";
import { Transcript } from "../chat/Transcript.tsx";
import { shortWhen } from "../common/format.ts";
import { loadThread } from "../data/actions.ts";
import { blobOf, DEFAULT_PID } from "../data/identity.ts";
import { useData } from "../data/state.ts";
import { closeTask, commentTask, createTask, loadTasks, taskEvents, updateTask, useTasks } from "../data/tasks.ts";
import { type MessageKey, type T, useT } from "../i18n/index.ts";

const COLUMN_KEYS: Record<string, MessageKey> = {
  backlog: "tasks.col.backlog",
  todo: "tasks.col.todo",
  doing: "tasks.col.doing",
  review: "tasks.col.review",
};

/** The default columns in the owner's language; a column the owner made shows its own name. */
const columnLabel = (c: TaskColumn, t: T) => {
  const key = COLUMN_KEYS[c.id];
  return key ? t(key) : c.label;
};

/** The office board: open tasks by column, the recently done ones apart. `projectId` narrows it to one project. */
export function TasksBoard({ projectId }: { projectId?: string | undefined }) {
  const t = useT();
  const all = useTasks((s) => s.tasks);
  const columns = useTasks((s) => s.columns);
  const ready = useTasks((s) => s.ready);
  const [open, setOpen] = useState<string>();
  const [creating, setCreating] = useState(false);
  const [show, setShow] = useState<"open" | "done">("open");
  useEffect(() => {
    void loadTasks();
  }, []);

  const tasks = useMemo(
    () =>
      Object.values(all)
        .filter((x) => !projectId || (projectId === DEFAULT_PID ? !x.project_id : x.project_id === projectId))
        .sort((a, b) => b.activity_at.localeCompare(a.activity_at)),
    [all, projectId],
  );
  const current = open ? all[open] : undefined;

  return (
    <div className="board">
      <div className="board__head">
        <SegmentedControl
          size="sm"
          label={t("tasks.show")}
          value={show}
          onValueChange={(v) => setShow(v as "open" | "done")}
          options={[
            { value: "open", label: t("tasks.open") },
            { value: "done", label: t("tasks.done") },
          ]}
        />
        <span className="board__spacer" />
        <Button size="sm" leadingIcon={<Icons.Plus size={14} />} onClick={() => setCreating(true)}>
          {t("tasks.new")}
        </Button>
      </div>
      {ready && !tasks.length ? (
        <EmptyState variant="dashed" size="lg" icon={<Icons.ListChecks />} title={t("tasks.emptyTitle")}>
          {t("tasks.empty")}
        </EmptyState>
      ) : show === "done" ? (
        <ul className="board__done">
          {tasks
            .filter((x) => x.state !== "open")
            .map((x) => (
              <TaskCard key={x.id} task={x} onOpen={() => setOpen(x.id)} />
            ))}
        </ul>
      ) : (
        <div className="board__columns">
          {columns.map((c) => {
            const cards = tasks.filter((x) => x.state === "open" && x.status === c.id);
            return (
              <section key={c.id} className="board__column" aria-label={c.label}>
                <header className="board__colhead">
                  {columnLabel(c, t)}
                  <span className="team__count">{cards.length}</span>
                </header>
                {cards.map((x) => (
                  <TaskCard key={x.id} task={x} onOpen={() => setOpen(x.id)} />
                ))}
              </section>
            );
          })}
        </div>
      )}
      {creating && <NewTask projectId={projectId} onClose={() => setCreating(false)} />}
      {current && <TaskDetail task={current} onClose={() => setOpen(undefined)} />}
    </div>
  );
}

function TaskCard({ task, onOpen }: { task: Task; onOpen: () => void }) {
  const t = useT();
  const agents = useData((s) => s.agents);
  const who = task.assignee ? agents[task.assignee] : undefined;
  return (
    <button type="button" className="taskcard" onClick={onOpen}>
      <span className="taskcard__title">{task.title}</span>
      <span className="taskcard__meta">
        {who && <AgentAvatar name={who.name} blob={blobOf(who)} size={16} />}
        {task.awaits_owner && (
          <Badge tone="warning" dot>
            {t("tasks.awaitsYou")}
          </Badge>
        )}
        {task.state !== "open" && <Badge>{t(`tasks.state.${task.state}`)}</Badge>}
        <span className="taskcard__when">{shortWhen(task.activity_at)}</span>
      </span>
    </button>
  );
}

function NewTask({ projectId, onClose }: { projectId?: string | undefined; onClose: () => void }) {
  const t = useT();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [assignee, setAssignee] = useState<string>();
  const save = async () => {
    await createTask({
      title: title.trim(),
      ...(description.trim() ? { description: description.trim() } : {}),
      ...(projectId && projectId !== DEFAULT_PID ? { project: projectId } : {}),
      ...(assignee ? { assignee } : {}),
    });
    onClose();
  };
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t("tasks.new")}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button disabled={!title.trim()} onClick={() => void save()}>
            {t("tasks.create")}
          </Button>
        </>
      }
    >
      <div className="pform">
        <Input
          aria-label={t("tasks.title")}
          placeholder={t("tasks.title")}
          value={title}
          onChange={(e) => setTitle(e.currentTarget.value)}
        />
        <Textarea
          aria-label={t("tasks.description")}
          placeholder={t("tasks.descriptionHint")}
          rows={4}
          value={description}
          onChange={(e) => setDescription(e.currentTarget.value)}
        />
        <AssigneePicker value={assignee} projectId={projectId} onChange={setAssignee} />
      </div>
    </Dialog>
  );
}

function AssigneePicker(props: {
  value?: string | undefined;
  projectId?: string | undefined;
  onChange: (id: string | undefined) => void;
}) {
  const t = useT();
  const agents = useData((s) => s.agents);
  const list = Object.values(agents).filter((a) => !a.project_id || a.project_id === props.projectId);
  const current = props.value ? agents[props.value] : undefined;
  return (
    <Menu
      trigger={
        <Button variant="secondary" size="sm" trailingIcon={<Icons.ChevronDown size={14} />}>
          {current && <AgentAvatar name={current.name} blob={blobOf(current)} size={16} />}
          {current?.name ?? t("tasks.nobody")}
        </Button>
      }
      items={[
        { label: t("tasks.nobody"), onSelect: () => props.onChange(undefined) },
        { type: "separator" as const },
        ...list.map((a) => ({ label: a.name, onSelect: () => props.onChange(a.id) })),
      ]}
    />
  );
}

/** One task: its column and owner, state buttons, history and conversation (comment with @agent to ask one). */
function TaskDetail({ task, onClose }: { task: Task; onClose: () => void }) {
  const t = useT();
  const columns = useTasks((s) => s.columns);
  const thread = useData((s) => s.threads[task.thread_id]);
  const load = useData((s) => s.threadLoad[task.thread_id]);
  const [events, setEvents] = useState<TaskEvent[]>([]);
  const [text, setText] = useState("");
  useEffect(() => {
    if (load == null) void loadThread(task.thread_id);
  }, [load, task.thread_id]);
  // The history is read again whenever the task moves (activity_at changes with every event).
  const movedAt = task.activity_at;
  useEffect(() => {
    void taskEvents(task.id).then((list) => movedAt && setEvents(list));
  }, [task.id, movedAt]);
  const send = async () => {
    if (await commentTask(task.id, text.trim())) setText("");
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} size="lg" title={task.title}>
      <div className="taskdetail">
        <div className="taskdetail__bar">
          <Menu
            trigger={
              <Button variant="secondary" size="sm" trailingIcon={<Icons.ChevronDown size={14} />}>
                {(() => {
                  const c = columns.find((x) => x.id === task.status);
                  return c ? columnLabel(c, t) : task.status;
                })()}
              </Button>
            }
            items={columns.map((c) => ({
              label: columnLabel(c, t),
              onSelect: () => void updateTask(task.id, { status: c.id }),
            }))}
          />
          <AssigneePicker
            value={task.assignee}
            projectId={task.project_id}
            onChange={(id) => void updateTask(task.id, { assignee: id ?? null })}
          />
          <span className="board__spacer" />
          {task.state === "open" ? (
            <>
              <Button size="sm" leadingIcon={<Icons.Check size={14} />} onClick={() => void closeTask(task.id, "done")}>
                {t("tasks.markDone")}
              </Button>
              <IconButton
                size="sm"
                label={t("tasks.drop")}
                icon={<Icons.X size={14} />}
                onClick={() => void closeTask(task.id, "dropped")}
              />
            </>
          ) : (
            <Button size="sm" variant="secondary" onClick={() => void closeTask(task.id, "open")}>
              {t("tasks.reopen")}
            </Button>
          )}
        </div>
        {task.description && <p className="taskdetail__desc">{task.description}</p>}
        <div className="taskdetail__history">
          {events.map((e, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: events are append-only.
            <div key={i} className="taskdetail__event">
              <span>{t(`tasks.op.${e.op}`, { by: e.by === "owner" ? t("tasks.you") : e.by })}</span>
              <span className="taskcard__when">{shortWhen(e.at)}</span>
            </div>
          ))}
        </div>
        <div className="taskdetail__chat">{thread && load === "ready" && <Transcript thread={thread} />}</div>
        <div className="memory__add">
          <Textarea
            aria-label={t("tasks.comment")}
            rows={2}
            placeholder={t("tasks.commentHint")}
            value={text}
            onChange={(e) => setText(e.currentTarget.value)}
          />
          <Button size="sm" disabled={!text.trim()} onClick={() => void send()}>
            {t("tasks.send")}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
