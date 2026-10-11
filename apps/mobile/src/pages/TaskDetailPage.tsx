import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, type StyleProp, StyleSheet, Text, TextInput, type TextStyle, View } from "react-native";
import { ago, dueWhen } from "../format";
import type { Task, Workspace } from "../hooks/useWorkspace";
import { type Key, t } from "../i18n";
import type { TaskEvent } from "../protocol";
import type { TaskComment } from "../tasks/comments";
import { columnName, KIND_KEY, PRIORITY_KEY, type TaskPatch, type TaskPriority, taskValues } from "../tasks/fields";
import { type HistoryKey, historyLines } from "../tasks/history";
import { TaskFields } from "../tasks/TaskFields";
import { closeChoices, confirmClose, failAlert, type TaskActions, TaskMenu } from "../tasks/TaskMenu";
import {
  AgentAvatar,
  Button,
  Card,
  EmptyState,
  IconButton,
  ListGroup,
  OwnerAvatar,
  Screen,
  Segmented,
  Spinner,
  SubHeader,
  Tag,
  Toggle,
  type,
} from "../ui/kit";
import { Markdown } from "../ui/Markdown";
import { theme } from "../ui/theme";

const EVENT_KEY: Record<HistoryKey, Key> = {
  create: "tkEvCreate",
  move: "tkEvMove",
  assign: "tkEvAssign",
  unassign: "tkEvUnassign",
  comment: "tkEvComment",
  done: "tkEvDone",
  drop: "tkEvDrop",
  reopen: "tkEvReopen",
  kept: "tkEvKept",
  missed: "tkEvMissed",
  renegotiate: "tkEvRenegotiate",
  priority: "tkEvPriority",
  due: "tkEvDue",
  undue: "tkEvUndue",
  project: "tkEvProject",
  edit: "tkEvEdit",
};
const OUTCOME_KEY: Record<NonNullable<Task["outcome"]>, Key> = {
  kept: "tkOutcomeKept",
  missed: "tkOutcomeMissed",
  dropped: "tkOutcomeDropped",
};

/**
 * One task: its title, the bar that closes or reopens it and opens its conversation, the description (tap or the
 * pencil to edit), its properties, and its comments beside its history. The "…" holds the rest (delete included).
 */
export function TaskDetailPage({
  task,
  data,
  back,
  actions,
  openThread,
}: {
  task?: Task;
  data: Workspace;
  back: () => void;
  actions: TaskActions;
  openThread: (id: string) => void;
}) {
  const [detail, setDetail] = useState<{ events: TaskEvent[]; comments: TaskComment[] }>();
  const [busy, setBusy] = useState<string>();
  const [menu, setMenu] = useState(false);
  const [tab, setTab] = useState<"comments" | "history">("comments");
  const taskId = task?.id;
  const activity = task?.activity_at;
  const { detail: load } = actions;
  const reload = useCallback(() => {
    if (!taskId) return;
    void load(taskId)
      .then(setDetail)
      .catch(() => setDetail((now) => now ?? { events: [], comments: [] }));
  }, [load, taskId]);
  // Read again whenever the task moves (a comment, a change from elsewhere).
  // biome-ignore lint/correctness/useExhaustiveDependencies: activity is the signal to reload, not an input.
  useEffect(reload, [reload, activity]);
  if (!task)
    return (
      <View style={s.page}>
        <SubHeader title={t("navTasks")} back={back} />
        <EmptyState title={t("tkGone")} body="" icon="ListChecks" />
      </View>
    );
  const open = task.state === "open";
  const fail = failAlert(task.title);
  const run = (label: string, work: () => Promise<unknown>) => {
    setBusy(label);
    work()
      .then(reload)
      .catch(fail)
      .finally(() => setBusy(undefined));
  };
  const update = (patch: TaskPatch) => run("update", () => actions.update(task.id, patch));
  const closedLabel = task.outcome
    ? t(OUTCOME_KEY[task.outcome])
    : t(task.state === "done" ? "tkStateDone" : "tkStateDropped");
  const comments = detail?.comments ?? [];
  const shown = comments.length ? tab : "history";
  return (
    <View style={s.page}>
      <SubHeader
        title={t(KIND_KEY[task.kind])}
        back={back}
        right={
          <View style={s.headerRight}>
            {busy === "update" ? (
              <Spinner size={16} />
            ) : open ? null : (
              <Tag tone={task.state === "done" ? "brand" : "neutral"}>{closedLabel}</Tag>
            )}
            <IconButton icon="MoreHorizontal" label={t("tkMore")} onPress={() => setMenu(true)} />
          </View>
        }
      />
      <Screen>
        <EditableText
          key={`title-${task.id}`}
          value={task.title}
          label={t("tkTitle")}
          placeholder={t("tkTitleHint")}
          maxLength={200}
          textStyle={[s.title, !open && s.closedTitle]}
          save={(title) => {
            const next = title.trim();
            if (next && next !== task.title) update({ title: next });
          }}
        />
        {task.kind === "commitment" && task.person_name ? (
          <Text style={[type.muted, s.inset]}>
            {t("tkPerson")}: {task.person_name}
            {task.due_at ? ` · ${dueWhen(task.due_at)}` : ""}
          </Text>
        ) : null}
        <View style={s.bar}>
          {closeChoices(task).map((choice, i) => (
            <Button
              key={choice.state}
              label={t(choice.label)}
              icon={choice.icon}
              size="sm"
              variant={i === 0 ? "primary" : "secondary"}
              busy={busy === choice.state}
              disabled={Boolean(busy)}
              style={s.barButton}
              onPress={() =>
                confirmClose(task, choice, () => run(choice.state, () => actions.close(task, choice.state)))
              }
            />
          ))}
          <Button
            label={t("tkChat")}
            icon="MessageCircle"
            size="sm"
            variant="secondary"
            style={s.barButton}
            onPress={() => openThread(task.thread_id)}
          />
        </View>
        <Description key={`description-${task.id}`} task={task} save={(description) => update({ description })} />
        <TaskFields data={data} value={taskValues(task)} onChange={update} />
        <ListGroup>
          <View style={s.toggleRow}>
            <Text style={[type.rowTitle, { flex: 1 }]}>{t("tkWaits")}</Text>
            <Toggle
              label={t("tkWaits")}
              value={task.awaits_owner}
              disabled={Boolean(busy)}
              onChange={(awaits_owner) => update({ awaits_owner })}
            />
          </View>
        </ListGroup>
        {comments.length ? (
          <Segmented
            value={shown}
            onChange={setTab}
            options={[
              { value: "comments", label: `${t("tkComments")} · ${comments.length}` },
              { value: "history", label: t("tkHistory") },
            ]}
          />
        ) : (
          <Text style={[type.meta, s.inset]}>{t("tkHistory")}</Text>
        )}
        {shown === "comments" ? (
          <Comments comments={comments} data={data} />
        ) : (
          <History events={detail?.events} data={data} />
        )}
      </Screen>
      {menu ? (
        <TaskMenu
          task={task}
          data={data}
          actions={actions}
          onClose={() => setMenu(false)}
          onConversation={() => openThread(task.thread_id)}
          onDeleted={back}
        />
      ) : null}
    </View>
  );
}

/**
 * Text that reads as text until a tap (or `edit` from outside) makes it a field; Save keeps it, Cancel puts it back.
 */
function EditableText({
  value,
  label,
  placeholder,
  maxLength,
  textStyle,
  multiline,
  save,
  editing: forced,
  onDone,
  children,
}: {
  value: string;
  label: string;
  placeholder: string;
  maxLength: number;
  textStyle?: StyleProp<TextStyle>;
  multiline?: boolean;
  save: (text: string) => void;
  editing?: boolean;
  onDone?: () => void;
  /** What shows at rest instead of the plain text (the description's markdown). */
  children?: React.ReactNode;
}) {
  const [own, setOwn] = useState(false);
  const [draft, setDraft] = useState(value);
  const editing = own || Boolean(forced);
  const stop = () => {
    setOwn(false);
    onDone?.();
  };
  if (!editing)
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${t("tkEdit")}: ${label}`}
        onPress={() => {
          setDraft(value);
          setOwn(true);
        }}
        style={s.inset}
      >
        {children ?? <Text style={[textStyle, !value && s.placeholder]}>{value || placeholder}</Text>}
      </Pressable>
    );
  return (
    <View style={s.editing}>
      <TextInput
        autoFocus
        value={draft}
        onChangeText={setDraft}
        placeholder={placeholder}
        placeholderTextColor={theme.fgSubtle}
        accessibilityLabel={label}
        maxLength={maxLength}
        multiline
        submitBehavior={multiline ? "newline" : "blurAndSubmit"}
        onSubmitEditing={
          multiline
            ? undefined
            : () => {
                save(draft);
                stop();
              }
        }
        style={[textStyle, s.input, multiline && s.inputTall]}
      />
      <View style={s.editActions}>
        <Button label={t("cancel")} variant="secondary" size="sm" onPress={stop} />
        <Button
          label={t("save")}
          size="sm"
          disabled={draft === value}
          onPress={() => {
            save(draft);
            stop();
          }}
        />
      </View>
    </View>
  );
}

/** The description as markdown, with a pencil; empty, a tap adds one. */
function Description({ task, save }: { task: Task; save: (text: string) => void }) {
  const [editing, setEditing] = useState(false);
  const text = task.description?.trim() ?? "";
  return (
    <Card style={s.descriptionCard}>
      <View style={s.descriptionHead}>
        <Text style={[type.meta, { flex: 1 }]}>{t("tkDescription")}</Text>
        {editing ? null : (
          <IconButton
            icon="Pencil"
            label={t("tkEdit")}
            size={16}
            color={theme.fgMuted}
            onPress={() => setEditing(true)}
            style={s.pencil}
          />
        )}
      </View>
      <EditableText
        // A fresh draft each time the pencil opens it.
        key={editing ? "editing" : "reading"}
        value={task.description ?? ""}
        label={t("tkDescription")}
        placeholder={t("tkAddDescription")}
        maxLength={10_000}
        textStyle={s.description}
        multiline
        editing={editing}
        onDone={() => setEditing(false)}
        save={(next) => {
          if (next !== (task.description ?? "")) save(next);
        }}
      >
        {text ? <Markdown text={text} /> : <Text style={[s.description, s.placeholder]}>{t("tkAddDescription")}</Text>}
      </EditableText>
    </Card>
  );
}

function Comments({ comments, data }: { comments: TaskComment[]; data: Workspace }) {
  return (
    <ListGroup>
      {comments.map((comment) => {
        const agent = comment.by === "owner" ? undefined : data.agents.find((item) => item.id === comment.by);
        const name = comment.by === "owner" ? data.owner || t("tkYou") : (agent?.name ?? comment.by);
        return (
          <View key={comment.id} style={s.comment}>
            <View style={s.commentHead}>
              {comment.by === "owner" ? (
                <OwnerAvatar name={name} size={24} />
              ) : (
                <AgentAvatar name={name} blob={agent?.blob} id={agent?.id ?? comment.by} size={24} />
              )}
              <Text style={[type.rowTitle, { flex: 1 }]} numberOfLines={1}>
                {name}
              </Text>
              <Text style={type.meta}>{ago(comment.at)}</Text>
            </View>
            <Markdown text={comment.text} />
          </View>
        );
      })}
    </ListGroup>
  );
}

function History({ events, data }: { events?: TaskEvent[]; data: Workspace }) {
  const lines = useMemo(
    () =>
      events
        ? historyLines(events, data.columns, {
            column: (id) => {
              const column = data.columns.find((item) => item.id === id);
              return column ? columnName(column, t) : id;
            },
            agent: (id) => data.agents.find((item) => item.id === id)?.name ?? id,
            project: (id) => data.projects.find((item) => item.id === id)?.name ?? t("defaultProject"),
            priority: (p) => (p in PRIORITY_KEY ? t(PRIORITY_KEY[p as TaskPriority]) : p),
            when: (iso) => dueWhen(iso),
          }).reverse()
        : undefined,
    [events, data.columns, data.agents, data.projects],
  );
  if (!lines)
    return (
      <View style={s.loading}>
        <Spinner size={18} />
      </View>
    );
  if (!lines.length) return <Text style={[type.muted, s.inset]}>{t("tkHistoryEmpty")}</Text>;
  return (
    <ListGroup>
      {lines.map((line, i) => {
        const agent = line.by === "owner" ? undefined : data.agents.find((item) => item.id === line.by);
        const name = line.by === "owner" ? t("tkYou") : (agent?.name ?? line.by);
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: two events can share a moment; the list only grows.
          <View key={`${line.at}-${i}`} style={s.event}>
            {line.by === "owner" ? (
              <OwnerAvatar name={name} size={24} />
            ) : (
              <AgentAvatar name={name} blob={agent?.blob} id={agent?.id ?? line.by} size={24} />
            )}
            <Text style={[type.body, { flex: 1 }]}>{t(EVENT_KEY[line.key], { name, ...line.vars })}</Text>
            <Text style={type.meta}>{ago(line.at)}</Text>
          </View>
        );
      })}
    </ListGroup>
  );
}

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: theme.bg },
  inset: { paddingHorizontal: 4 },
  headerRight: { flexDirection: "row", alignItems: "center", gap: 2 },
  title: { color: theme.fg, fontSize: 22, fontWeight: "600", lineHeight: 28 },
  closedTitle: { color: theme.fgMuted, textDecorationLine: "line-through" },
  placeholder: { color: theme.fgSubtle },
  bar: { flexDirection: "row", gap: 8 },
  barButton: { flex: 1, alignSelf: "stretch", paddingHorizontal: 8 },
  editing: { gap: 8 },
  input: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 14,
    backgroundColor: theme.fill,
    textAlignVertical: "top",
  },
  inputTall: { minHeight: 120 },
  editActions: { flexDirection: "row", justifyContent: "flex-end", gap: 8 },
  descriptionCard: { gap: 2, paddingTop: 4 },
  descriptionHead: { flexDirection: "row", alignItems: "center", paddingLeft: 4 },
  pencil: { width: 36, height: 36, marginRight: -8 },
  description: { color: theme.fg, fontSize: 14, lineHeight: 20 },
  toggleRow: { minHeight: 56, flexDirection: "row", alignItems: "center", gap: 14, paddingHorizontal: 14 },
  comment: { gap: 6, paddingVertical: 10, paddingHorizontal: 14 },
  commentHead: { flexDirection: "row", alignItems: "center", gap: 10 },
  event: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10, paddingHorizontal: 14 },
  loading: { padding: 24, alignItems: "center" },
});
