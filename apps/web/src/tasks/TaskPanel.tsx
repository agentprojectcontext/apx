import type { Message, Task, TaskEvent } from "@apx/protocol";
import {
  AgentAvatar,
  Badge,
  Button,
  IconButton,
  Icons,
  MarkdownView,
  Menu,
  Select,
  Skeleton,
  Tabs,
  TagInput,
  Textarea,
} from "@apx/ui";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { QuoteContext, quoteBlock } from "../chat/quote.ts";
import { Transcript } from "../chat/Transcript.tsx";
import { Drawer } from "../common/Drawer.tsx";
import { shortWhen } from "../common/format.ts";
import { AgentSelect } from "../common/pickers/AgentSelect.tsx";
import { ProjectSelect } from "../common/pickers/ProjectSelect.tsx";
import { useMarkdownLabels } from "../common/useMarkdownLabels.ts";
import { loadThread } from "../data/actions.ts";
import { baseName, blobOf } from "../data/identity.ts";
import { useOwnerName } from "../data/owner.ts";
import { useData } from "../data/state.ts";
import {
  acceptTasks,
  closeTask,
  settleTask,
  type TaskDetail,
  taskDetail,
  updateTask,
  useTasks,
} from "../data/tasks.ts";
import { useT } from "../i18n/index.ts";
import { formatCompact } from "./compact.ts";
import { historyLines } from "./history.ts";
import { mentionToken } from "./mentions.ts";
import { TaskComment } from "./TaskComment.tsx";
import {
  DueField,
  KindControl,
  OwedByControl,
  PersonSelect,
  PRIORITY_KEY,
  PrioritySelect,
  ReminderField,
} from "./TaskFields.tsx";
import { ColumnDot, ColumnHelp, columnLabel, KindHelp } from "./TaskForms.tsx";
import { TaskParent, TaskSubtasks, TaskUsage, TaskWork } from "./TaskWork.tsx";
import { copyItems } from "./taskActions.tsx";
import { pickerValue, type Reminder, remindAt, reminderOf } from "./when.ts";

/**
 * One task beside the list (the list stays in view): its state, every property editable in place, what it is about,
 * and its conversation or history; a comment with @agent asks that agent there.
 */
export function TaskPanel({ task, onClose, actions }: { task: Task; onClose: () => void; actions?: ReactNode }) {
  const t = useT();
  const thread = useData((s) => s.threads[task.thread_id]);
  const load = useData((s) => s.threadLoad[task.thread_id]);
  // Another task's history never shows while this one's is read.
  const [read, setRead] = useState<TaskDetail & { task: string }>();
  const events = read?.task === task.id ? read.events : undefined;
  const detail = read?.task === task.id ? read : undefined;
  const [tab, setTab] = useState("chat");
  const [text, setText] = useState("");
  const [focus, setFocus] = useState(0);
  const body = useRef<HTMLDivElement>(null);
  const chat = useRef<HTMLDivElement>(null);
  const toEnd = () => requestAnimationFrame(() => body.current?.scrollTo({ top: body.current.scrollHeight }));
  // The conversation grows inside the panel: while the owner is at its end, new answers stay in view.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the conversation's box is there again with its tab
  useEffect(() => {
    const el = body.current;
    const inner = chat.current;
    if (!el || !inner) return;
    let atEnd = false;
    const onScroll = () => {
      atEnd = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    };
    const grew = new ResizeObserver(() => atEnd && el.scrollTo({ top: el.scrollHeight }));
    el.addEventListener("scroll", onScroll);
    grew.observe(inner);
    return () => {
      el.removeEventListener("scroll", onScroll);
      grew.disconnect();
    };
  }, [tab]);
  const agents = useData((s) => s.agents);
  const owner = useOwnerName() || t("tasks.ev.owner");
  // A bubble quoted (or answered) goes on top of the comment; an answer to an agent asks that agent again.
  const quote = (m: Message, words: string, reply: boolean) => {
    const agent = m.author.kind === "agent" ? agents[m.author.id] : undefined;
    const author = m.author.kind === "user" ? owner : m.author.kind === "person" ? m.author.name : (agent?.name ?? "");
    const ask = reply && agent ? `@${mentionToken(agent, Object.values(agents), task.project_id)} ` : "";
    setText((draft) => `${quoteBlock(author, words)}\n\n${draft.trim() ? `${draft.trim()}\n` : ""}${ask}`);
    setTab("chat");
    setFocus((n) => n + 1);
  };
  useEffect(() => {
    if (load == null) void loadThread(task.thread_id);
  }, [load, task.thread_id]);
  // The history is read again whenever the task moves (activity_at changes with every event).
  const movedAt = task.activity_at;
  useEffect(() => {
    let current = true;
    void taskDetail(task.id).then((detail) => current && movedAt && setRead({ task: task.id, ...detail }));
    return () => {
      current = false;
    };
  }, [task.id, movedAt]);
  return (
    <Drawer
      className="taskpanel"
      label={task.title}
      title={<Title task={task} />}
      onClose={onClose}
      actions={
        <>
          {actions}
          <Menu
            trigger={<IconButton size="sm" label={t("common.more")} icon={<Icons.Ellipsis size={14} />} />}
            items={copyItems(task, t)}
          />
        </>
      }
    >
      <div className="taskpanel__body" ref={body}>
        <StateBar task={task} />
        <Properties task={task} detail={detail} />
        <TaskActivity task={task} detail={detail} />
        <Description task={task} />
        {task.plan?.trim() && <TaskPlan plan={task.plan} />}
        <Tabs
          variant="pill"
          className="taskpanel__tabs"
          value={tab}
          onValueChange={(value) => {
            setTab(value);
            if (value === "chat") toEnd();
          }}
          items={[
            {
              value: "chat",
              label: t("tasks.tab.chat"),
              content: (
                <QuoteContext.Provider value={quote}>
                  <div className="taskdetail__chat" ref={chat}>
                    {thread && load === "ready" ? (
                      <Transcript thread={thread} comments />
                    ) : (
                      load !== "error" && <ConversationSkeleton />
                    )}
                  </div>
                  <TaskComment task={task} text={text} onChange={setText} focus={focus} onSent={toEnd} />
                </QuoteContext.Provider>
              ),
            },
            {
              value: "history",
              label: t("tasks.tab.history"),
              ...(events ? { count: events.length } : {}),
              content: events ? <History events={events} /> : <HistorySkeleton />,
            },
          ]}
        />
      </div>
    </Drawer>
  );
}

/**
 * Below the properties: the chats the task was worked in and what it consumed, each a button that opens its list
 * (a session opens in the inbox).
 */
function TaskActivity({ task, detail }: { task: Task; detail: TaskDetail | undefined }) {
  const t = useT();
  const [shown, setShown] = useState<"sessions" | "usage">();
  const count = (detail?.sessions.length ?? 0) + (detail?.consults.length ?? 0);
  const tokens = detail?.usage.reduce((n, u) => n + u.input + u.output, 0) ?? 0;
  const toggle = (which: "sessions" | "usage") => setShown((s) => (s === which ? undefined : which));
  return (
    <div className="taskdetail__activity">
      <div className="taskdetail__activitybar">
        <Button
          size="sm"
          variant={shown === "sessions" ? "secondary" : "ghost"}
          aria-expanded={shown === "sessions"}
          leadingIcon={<Icons.MessagesSquare size={14} />}
          onClick={() => toggle("sessions")}
        >
          {detail ? t("tasks.work.count", { count }) : t("tasks.work.label")}
        </Button>
        <Button
          size="sm"
          variant={shown === "usage" ? "secondary" : "ghost"}
          aria-expanded={shown === "usage"}
          leadingIcon={<Icons.Activity size={14} />}
          onClick={() => toggle("usage")}
        >
          {detail?.usage.length ? t("tasks.usage.count", { tokens: formatCompact(tokens) }) : t("tasks.usage")}
        </Button>
      </div>
      {shown === "sessions" && <TaskWork task={task} sessions={detail?.sessions} consults={detail?.consults} />}
      {shown === "usage" &&
        (detail?.usage.length ? (
          <TaskUsage usage={detail.usage} />
        ) : (
          <span className="taskwork__none">{t("tasks.usage.none")}</span>
        ))}
    </div>
  );
}

/** Its column (how it ended, once closed: it keeps its column to go back to on reopen), and done / drop (or reopen). */
function StateBar({ task }: { task: Task }) {
  const t = useT();
  const columns = useTasks((s) => s.columns);
  const closed = task.state !== "open";
  const ended =
    task.state === "dropped"
      ? { label: t("tasks.dropped"), icon: <Icons.X size={12} /> }
      : { label: t("tasks.done"), icon: <Icons.Check size={12} /> };
  return (
    <div className="taskdetail__bar">
      <Select
        size="sm"
        label={t("tasks.column")}
        className="taskdetail__status"
        value={closed ? task.state : task.status}
        disabled={closed}
        onValueChange={(v) => v && v !== task.status && void updateTask(task.id, { status: v, awaits_owner: false })}
        options={
          closed
            ? [{ value: task.state, ...ended }]
            : columns.map((c) => ({ value: c.id, label: columnLabel(c, t), icon: <ColumnDot id={c.id} /> }))
        }
      />
      <ColumnHelp />
      <span className="board__spacer" />
      {task.kind === "commitment" ? (
        <CommitmentActions task={task} />
      ) : task.state === "open" && task.proposed ? (
        <>
          <Button size="sm" leadingIcon={<Icons.Check size={14} />} onClick={() => void acceptTasks([task.id])}>
            {t("tasks.accept")}
          </Button>
          <DropButton task={task} />
        </>
      ) : task.state === "open" ? (
        <>
          <Button
            size="sm"
            variant="outline"
            leadingIcon={<Icons.Check size={14} />}
            onClick={() => void closeTask(task.id, "done")}
          >
            {t("tasks.markDone")}
          </Button>
          <DropButton task={task} />
        </>
      ) : (
        <Button size="sm" variant="secondary" onClick={() => void closeTask(task.id, "open")}>
          {t("tasks.reopen")}
        </Button>
      )}
    </div>
  );
}

/** Dropping, as an icon beside the main action so the bar stays one line in a narrow panel. */
function DropButton({ task }: { task: Task }) {
  const t = useT();
  return (
    <IconButton
      size="sm"
      variant="outline"
      label={t("tasks.drop")}
      icon={<Icons.X size={14} />}
      onClick={() => void closeTask(task.id, "dropped")}
    />
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
function Properties({ task, detail }: { task: Task; detail: TaskDetail | undefined }) {
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
      <Prop label={t("tasks.type")} help={<KindHelp />}>
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
          globalAgents={task.project_id ? "secretary" : "all"}
          none={t("tasks.nobody")}
          onChange={(id) => id !== task.assignee && void updateTask(task.id, { assignee: id ?? null })}
        />
      </Prop>
      {task.parent_id && (
        <Prop label={t("tasks.parent")}>
          <TaskParent id={task.parent_id} />
        </Prop>
      )}
      {detail && detail.subtasks.length > 0 && (
        <Prop label={t("tasks.subtasks")} top>
          <TaskSubtasks subtasks={detail.subtasks} />
        </Prop>
      )}
      {task.state === "open" && (task.status === "review" || task.reviewer) && (
        <Prop label={t("tasks.reviewer")}>
          <AgentSelect
            size="sm"
            value={task.reviewer}
            projectId={task.project_id}
            globalAgents={task.project_id ? "secretary" : "all"}
            none={t("tasks.reviewerOwner")}
            onChange={(id) => id !== task.reviewer && void updateTask(task.id, { reviewer: id ?? null })}
          />
        </Prop>
      )}
      {task.state === "open" && task.kind === "task" && detail && !detail.sessions.length && (
        <Prop label={t("tasks.start")}>
          <DueField
            size="sm"
            label={t("tasks.startNow")}
            value={pickerValue(task.start_at)}
            onChange={(v) => v !== pickerValue(task.start_at) && void updateTask(task.id, { start_at: v ?? null })}
          />
        </Prop>
      )}
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

/** One property; `top` keeps its label at the first line of a value that runs several lines (a list). */
function Prop({ label, help, top, children }: { label: string; help?: ReactNode; top?: boolean; children: ReactNode }) {
  return (
    <>
      <dt className={top ? "taskprops__label taskprops__label--top" : "taskprops__label"}>
        {label}
        {help}
      </dt>
      <dd className="taskprops__value">{children}</dd>
    </>
  );
}

/** The title, edited in place: saved on Enter or leaving the box; Escape or an empty box keeps the old one. */
function Title({ task }: { task: Task }) {
  const t = useT();
  const [draft, setDraft] = useState(task.title);
  useEffect(() => setDraft(task.title), [task.title]);
  const save = () => {
    const title = draft.trim();
    if (title && title !== task.title) void updateTask(task.id, { title });
    else setDraft(task.title);
  };
  return (
    <textarea
      className="taskpanel__title"
      aria-label={t("tasks.rename")}
      rows={1}
      maxLength={200}
      value={draft}
      onChange={(e) => setDraft(e.currentTarget.value.replace(/\n/g, " "))}
      onBlur={save}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          e.currentTarget.blur();
        } else if (e.key === "Escape") {
          // The drawer stays open: Escape here only drops the edit.
          e.preventDefault();
          setDraft(task.title);
          requestAnimationFrame(() => (e.target as HTMLTextAreaElement).blur());
        }
      }}
    />
  );
}

/** The plan its agent keeps on the task: the steps and where it stands, read again on every turn of its work. */
function TaskPlan({ plan }: { plan: string }) {
  const t = useT();
  const labels = useMarkdownLabels();
  return (
    <section className="taskdetail__plan" aria-label={t("tasks.plan")}>
      <h3 className="taskdetail__planhead">{t("tasks.plan")}</h3>
      <MarkdownView source={plan} size="sm" labels={labels} />
    </section>
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
      rows={Math.min(14, Math.max(6, draft.split("\n").length))}
      value={draft}
      onChange={(e) => setDraft(e.currentTarget.value)}
      onBlur={() => draft !== task.description && void updateTask(task.id, { description: draft })}
    />
  );
}

/** Who did what, newest first, always by name: "Alex moved it from Pending to Review", "Roby marked it done". */
function History({ events }: { events: TaskEvent[] }) {
  const t = useT();
  const owner = useOwnerName() || t("tasks.ev.owner");
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
        project: (id) => (id ? (projects.find((p) => p.id === id)?.name ?? id) : baseName()),
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
              {t(`tasks.ev.${l.key}`, { ...l.vars, name: l.by === "owner" ? owner : (agent?.name ?? l.by) })}
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

/** While the conversation loads: the shape of a few comments, not an empty box. */
function ConversationSkeleton() {
  return (
    <div className="taskpanel__skeleton" aria-busy="true">
      <Skeleton width="45%" height={36} shape="block" style={{ alignSelf: "flex-end" }} />
      <Skeleton width="70%" height={56} shape="block" />
      <Skeleton width="55%" height={40} shape="block" />
    </div>
  );
}

function HistorySkeleton() {
  return (
    <div className="taskpanel__skeleton" aria-busy="true">
      {[70, 55, 62].map((w) => (
        <Skeleton key={w} width={`${w}%`} />
      ))}
    </div>
  );
}
