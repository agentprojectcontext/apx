import type { Task, TaskEvent } from "@apx/protocol";
import { AgentAvatar, Badge, Button, IconButton, Icons, Select, Tabs, TagInput, Textarea } from "@apx/ui";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { Transcript } from "../chat/Transcript.tsx";
import { shortWhen } from "../common/format.ts";
import { AgentSelect } from "../common/pickers/AgentSelect.tsx";
import { ProjectSelect } from "../common/pickers/ProjectSelect.tsx";
import { loadThread } from "../data/actions.ts";
import { blobOf, DEFAULT_PROJECT } from "../data/identity.ts";
import { useData } from "../data/state.ts";
import { closeTask, commentTask, settleTask, taskEvents, updateTask, useTasks } from "../data/tasks.ts";
import { type MessageKey, useT } from "../i18n/index.ts";
import { type HistoryKey, historyLines } from "./history.ts";
import {
  DueField,
  KindControl,
  OwedByControl,
  PersonSelect,
  PRIORITY_KEY,
  PrioritySelect,
  ReminderField,
} from "./TaskFields.tsx";
import { columnLabel } from "./TaskForms.tsx";
import { pickerValue, type Reminder, remindAt, reminderOf } from "./when.ts";

/** What each history line says after the author, for the owner ("You …") and for an agent ("Roby …"). */
const HISTORY: Record<HistoryKey, [MessageKey, MessageKey]> = {
  create: ["tasks.ev.create.you", "tasks.ev.create"],
  move: ["tasks.ev.move.you", "tasks.ev.move"],
  assign: ["tasks.ev.assign.you", "tasks.ev.assign"],
  unassign: ["tasks.ev.unassign.you", "tasks.ev.unassign"],
  comment: ["tasks.ev.comment.you", "tasks.ev.comment"],
  done: ["tasks.ev.done.you", "tasks.ev.done"],
  drop: ["tasks.ev.drop.you", "tasks.ev.drop"],
  reopen: ["tasks.ev.reopen.you", "tasks.ev.reopen"],
  kept: ["tasks.ev.kept.you", "tasks.ev.kept"],
  missed: ["tasks.ev.missed.you", "tasks.ev.missed"],
  renegotiate: ["tasks.ev.renegotiate.you", "tasks.ev.renegotiate"],
  priority: ["tasks.ev.priority.you", "tasks.ev.priority"],
  due: ["tasks.ev.due.you", "tasks.ev.due"],
  undue: ["tasks.ev.undue.you", "tasks.ev.undue"],
  project: ["tasks.ev.project.you", "tasks.ev.project"],
  edit: ["tasks.ev.edit.you", "tasks.ev.edit"],
};

/**
 * One task beside the list (the list stays in view): its state, every property editable in place, what it is about,
 * and its conversation or history; a comment with @agent asks that agent there.
 */
export function TaskPanel({ task, onClose }: { task: Task; onClose: () => void }) {
  const t = useT();
  const thread = useData((s) => s.threads[task.thread_id]);
  const load = useData((s) => s.threadLoad[task.thread_id]);
  const [events, setEvents] = useState<TaskEvent[]>([]);
  const [tab, setTab] = useState("chat");
  const [text, setText] = useState("");
  useEffect(() => {
    if (load == null) void loadThread(task.thread_id);
  }, [load, task.thread_id]);
  // The history is read again whenever the task moves (activity_at changes with every event).
  const movedAt = task.activity_at;
  useEffect(() => {
    let current = true;
    void taskEvents(task.id).then((list) => current && movedAt && setEvents(list));
    return () => {
      current = false;
    };
  }, [task.id, movedAt]);
  const send = async () => {
    if (await commentTask(task.id, text.trim())) setText("");
  };

  return (
    <aside className="taskpanel" aria-label={task.title}>
      <header className="taskpanel__head">
        <h2 className="taskpanel__title">{task.title}</h2>
        <IconButton size="sm" label={t("common.close")} icon={<Icons.X size={14} />} onClick={onClose} />
      </header>
      <StateBar task={task} />
      <Properties task={task} />
      <Description task={task} />
      <Tabs
        variant="pill"
        className="taskpanel__tabs"
        value={tab}
        onValueChange={setTab}
        items={[
          {
            value: "chat",
            label: t("tasks.tab.chat"),
            content: (
              <div className="taskdetail__chat">{thread && load === "ready" && <Transcript thread={thread} />}</div>
            ),
          },
          {
            value: "history",
            label: t("tasks.tab.history"),
            count: events.length,
            content: <History events={events} />,
          },
        ]}
      />
      <div className="taskpanel__comment">
        <Textarea
          aria-label={t("tasks.comment")}
          rows={2}
          placeholder={t("tasks.commentHint")}
          value={text}
          onChange={(e) => setText(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && text.trim()) void send();
          }}
        />
        <Button size="sm" disabled={!text.trim()} onClick={() => void send()}>
          {t("tasks.send")}
        </Button>
      </div>
    </aside>
  );
}

/** Its column, and done / drop (or reopen). */
function StateBar({ task }: { task: Task }) {
  const t = useT();
  const columns = useTasks((s) => s.columns);
  return (
    <div className="taskdetail__bar">
      <Select
        size="sm"
        label={t("tasks.column")}
        className="taskdetail__status"
        value={task.status}
        disabled={task.state !== "open"}
        onValueChange={(v) => v && v !== task.status && void updateTask(task.id, { status: v })}
        options={columns.map((c) => ({ value: c.id, label: columnLabel(c, t) }))}
      />
      <span className="board__spacer" />
      {task.kind === "commitment" ? (
        <CommitmentActions task={task} />
      ) : task.state === "open" ? (
        <>
          <Button size="sm" leadingIcon={<Icons.Check size={14} />} onClick={() => void closeTask(task.id, "done")}>
            {t("tasks.markDone")}
          </Button>
          <Button size="sm" variant="secondary" onClick={() => void closeTask(task.id, "dropped")}>
            {t("tasks.drop")}
          </Button>
        </>
      ) : (
        <Button size="sm" variant="secondary" onClick={() => void closeTask(task.id, "open")}>
          {t("tasks.reopen")}
        </Button>
      )}
    </div>
  );
}

/** A commitment ends kept, missed or released; a new date agreed with the person keeps it open. */
function CommitmentActions({ task }: { task: Task }) {
  const t = useT();
  if (task.state !== "open")
    return (
      <>
        {task.outcome && (
          <Badge tone={task.outcome === "kept" ? "brand" : "neutral"}>{t(`tasks.outcome.${task.outcome}`)}</Badge>
        )}
        <Button size="sm" variant="secondary" onClick={() => void closeTask(task.id, "open")}>
          {t("tasks.reopen")}
        </Button>
      </>
    );
  return (
    <>
      {task.renegotiated > 0 && <Badge>{t("tasks.renegotiated", { n: String(task.renegotiated) })}</Badge>}
      <Button size="sm" leadingIcon={<Icons.Check size={14} />} onClick={() => void settleTask(task.id, "kept")}>
        {t("tasks.kept")}
      </Button>
      <Button size="sm" variant="secondary" onClick={() => void settleTask(task.id, "missed")}>
        {t("tasks.missed")}
      </Button>
      <DueField
        size="sm"
        label={t("tasks.newDate")}
        value={undefined}
        onChange={(v) => v && void settleTask(task.id, "renegotiated", v)}
      />
      <Button size="sm" variant="ghost" onClick={() => void settleTask(task.id, "dropped")}>
        {t("tasks.release")}
      </Button>
    </>
  );
}

/** Every property, editable where it is shown; changes save at once. */
function Properties({ task }: { task: Task }) {
  const t = useT();
  const due = pickerValue(task.due_at);
  const remind = pickerValue(task.remind_at);
  const reminder = reminderOf(due, remind);
  const setReminder = (choice: Reminder, custom: string | undefined) => {
    const next = remindAt(due, choice, custom);
    if ((next ?? null) !== (remind ?? null)) void updateTask(task.id, { remind_at: next ?? null });
  };
  return (
    <dl className="taskprops">
      <Prop label={t("tasks.type")}>
        <KindControl value={task.kind} onChange={(kind) => void updateTask(task.id, { kind })} />
      </Prop>
      {task.kind === "commitment" && (
        <Prop label={t("commitments.person.label")}>
          <div className="taskprops__pair">
            <PersonSelect
              size="sm"
              value={task.person_id}
              onChange={(id) => void updateTask(task.id, { person: id ?? null })}
            />
            {task.person_id && (
              <OwedByControl
                value={task.owed_by ?? "owner"}
                onChange={(owed_by) => void updateTask(task.id, { owed_by })}
              />
            )}
          </div>
        </Prop>
      )}
      <Prop label={t("pickers.project")}>
        <ProjectSelect
          size="sm"
          value={task.project_id}
          onChange={(project) => project !== task.project_id && void updateTask(task.id, { project: project ?? null })}
        />
      </Prop>
      <Prop label={t("tasks.assignee")}>
        <AgentSelect
          size="sm"
          value={task.assignee}
          projectId={task.project_id}
          none={t("tasks.nobody")}
          onChange={(id) => id !== task.assignee && void updateTask(task.id, { assignee: id ?? null })}
        />
      </Prop>
      <Prop label={t("commitments.due")}>
        <DueField
          size="sm"
          value={due}
          onChange={(v) => v !== due && void updateTask(task.id, { due_at: v ?? null })}
        />
      </Prop>
      <Prop label={t("tasks.reminder")}>
        <ReminderField size="sm" due={due} choice={reminder} custom={remind} onChange={setReminder} />
      </Prop>
      <Prop label={t("tasks.priority")}>
        <PrioritySelect
          size="sm"
          value={task.priority}
          onChange={(priority) => void updateTask(task.id, { priority })}
        />
      </Prop>
      <Prop label={t("tasks.tags")}>
        <TagInput
          label={t("tasks.tags")}
          removeLabel={t("tasks.tagRemove")}
          placeholder={t("tasks.tagsPlaceholder")}
          value={task.tags}
          onValueChange={(tags) => void updateTask(task.id, { tags })}
        />
      </Prop>
    </dl>
  );
}

function Prop({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="taskprops__label">{label}</dt>
      <dd className="taskprops__value">{children}</dd>
    </>
  );
}

/** What the task is about; saved when the owner leaves the box. */
function Description({ task }: { task: Task }) {
  const t = useT();
  const [draft, setDraft] = useState(task.description);
  useEffect(() => setDraft(task.description), [task.description]);
  return (
    <Textarea
      className="taskdetail__desc"
      aria-label={t("tasks.description")}
      placeholder={t("tasks.descriptionHint")}
      rows={Math.min(8, Math.max(2, draft.split("\n").length))}
      value={draft}
      onChange={(e) => setDraft(e.currentTarget.value)}
      onBlur={() => draft !== task.description && void updateTask(task.id, { description: draft })}
    />
  );
}

/** Who did what, newest first: "You moved it from Pending to Review", "Roby marked it done". */
function History({ events }: { events: TaskEvent[] }) {
  const t = useT();
  const agents = useData((s) => s.agents);
  const projects = useData((s) => s.projects);
  const columns = useTasks((s) => s.columns);
  const lines = useMemo(
    () =>
      historyLines(events, columns, {
        column: (id) => {
          const c = columns.find((x) => x.id === id);
          return c ? columnLabel(c, t) : id;
        },
        agent: (id) => agents[id]?.name ?? id,
        project: (id) => (id ? (projects.find((p) => p.id === id)?.name ?? id) : DEFAULT_PROJECT),
        priority: (p) => (p in PRIORITY_KEY ? t(PRIORITY_KEY[p as keyof typeof PRIORITY_KEY]) : p),
        when: (iso) => shortWhen(iso),
      }).reverse(),
    [events, columns, agents, projects, t],
  );
  if (!lines.length) return <p className="taskhistory__empty">{t("tasks.historyEmpty")}</p>;
  return (
    <ol className="taskhistory">
      {lines.map((l, i) => {
        const agent = l.by === "owner" ? undefined : agents[l.by];
        const [mine, theirs] = HISTORY[l.key];
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: the history is append-only.
          <li key={i} className="taskhistory__line">
            {agent ? (
              <AgentAvatar name={agent.name} blob={blobOf(agent)} size={18} animated={false} />
            ) : (
              <span className="taskhistory__you" aria-hidden="true">
                <Icons.User size={11} />
              </span>
            )}
            <span className="taskhistory__text">
              {l.by === "owner" ? t(mine, l.vars) : t(theirs, { ...l.vars, name: agent?.name ?? l.by })}
            </span>
            <time className="taskhistory__when" dateTime={l.at}>
              {shortWhen(l.at)}
            </time>
          </li>
        );
      })}
    </ol>
  );
}
