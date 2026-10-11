import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, StyleSheet, Text, TextInput, View } from "react-native";
import { ago, dueWhen } from "../format";
import type { Task, Workspace } from "../hooks/useWorkspace";
import { type Key, t } from "../i18n";
import type { TaskEvent } from "../protocol";
import { columnName, KIND_KEY, PRIORITY_KEY, type TaskPatch, type TaskPriority, taskValues } from "../tasks/fields";
import { type HistoryKey, historyLines } from "../tasks/history";
import { TaskFields } from "../tasks/TaskFields";
import {
  AgentAvatar,
  Button,
  Card,
  EmptyState,
  ListGroup,
  OwnerAvatar,
  Screen,
  Spinner,
  SubHeader,
  Tag,
  Toggle,
  type,
} from "../ui/kit";
import { theme } from "../ui/theme";

export type TaskActions = {
  detail: (taskId: string) => Promise<TaskEvent[]>;
  update: (taskId: string, patch: TaskPatch) => Promise<Task>;
  close: (task: Task, state: "done" | "dropped" | "open" | "missed") => Promise<Task>;
};

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

/** One task: its title and description to edit, its properties, closing or reopening it, and its history. */
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
  const [events, setEvents] = useState<TaskEvent[]>();
  const [busy, setBusy] = useState<string>();
  const taskId = task?.id;
  const { detail } = actions;
  const reload = useCallback(() => {
    if (!taskId) return;
    void detail(taskId)
      .then(setEvents)
      .catch(() => setEvents((list) => list ?? []));
  }, [detail, taskId]);
  useEffect(reload, [reload]);
  if (!task)
    return (
      <View style={s.page}>
        <SubHeader title={t("navTasks")} back={back} />
        <EmptyState title={t("tkGone")} body="" icon="ListChecks" />
      </View>
    );
  const open = task.state === "open";
  const commitment = task.kind === "commitment";
  const run = (label: string, work: () => Promise<unknown>) => {
    setBusy(label);
    work()
      .then(reload)
      .catch((error) => Alert.alert(task.title, error instanceof Error ? error.message : String(error)))
      .finally(() => setBusy(undefined));
  };
  const update = (patch: TaskPatch) => run("update", () => actions.update(task.id, patch));
  const close = (state: "done" | "dropped" | "open" | "missed") => run(state, () => actions.close(task, state));
  const closedLabel = task.outcome
    ? t(OUTCOME_KEY[task.outcome])
    : t(task.state === "done" ? "tkStateDone" : "tkStateDropped");
  return (
    <View style={s.page}>
      <SubHeader
        title={t(KIND_KEY[task.kind])}
        back={back}
        right={
          busy === "update" ? (
            <Spinner size={16} />
          ) : open ? undefined : (
            <Tag tone={task.state === "done" ? "brand" : "neutral"}>{closedLabel}</Tag>
          )
        }
      />
      <Screen>
        <TextFields key={task.id} task={task} save={update} />
        {commitment && task.person_name ? (
          <Text style={[type.muted, s.inset]}>
            {t("tkPerson")}: {task.person_name}
            {task.due_at ? ` · ${dueWhen(task.due_at)}` : ""}
          </Text>
        ) : null}
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
        <View style={s.actions}>
          {open ? (
            commitment ? (
              <>
                <Button label={t("tkKept")} icon="CircleCheck" busy={busy === "done"} onPress={() => close("done")} />
                <Button
                  label={t("tkMissed")}
                  icon="CircleX"
                  variant="secondary"
                  busy={busy === "missed"}
                  onPress={() => close("missed")}
                />
                <Button
                  label={t("tkRelease")}
                  variant="secondary"
                  busy={busy === "dropped"}
                  onPress={() => close("dropped")}
                />
              </>
            ) : (
              <>
                <Button
                  label={t("tkMarkDone")}
                  icon="CircleCheck"
                  busy={busy === "done"}
                  onPress={() => close("done")}
                />
                <Button
                  label={t("tkDrop")}
                  icon="CircleX"
                  variant="secondary"
                  busy={busy === "dropped"}
                  onPress={() => close("dropped")}
                />
              </>
            )
          ) : (
            <Button label={t("tkReopen")} icon="RotateCcw" busy={busy === "open"} onPress={() => close("open")} />
          )}
          <Button
            label={t("tkConversation")}
            icon="MessageCircle"
            variant="secondary"
            onPress={() => openThread(task.thread_id)}
          />
        </View>
        <Text style={[type.meta, s.inset]}>{t("tkHistory")}</Text>
        <History events={events} data={data} />
      </Screen>
    </View>
  );
}

/** Title and description, saved when the owner leaves the field (an empty title keeps the old one). */
function TextFields({ task, save }: { task: Task; save: (patch: TaskPatch) => void }) {
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description ?? "");
  useEffect(() => setTitle(task.title), [task.title]);
  useEffect(() => setDescription(task.description ?? ""), [task.description]);
  return (
    <Card style={s.textCard}>
      <TextInput
        value={title}
        onChangeText={setTitle}
        onEndEditing={() => {
          const next = title.trim();
          if (!next) setTitle(task.title);
          else if (next !== task.title) save({ title: next });
        }}
        placeholder={t("tkTitleHint")}
        placeholderTextColor={theme.fgSubtle}
        accessibilityLabel={t("tkTitle")}
        maxLength={200}
        multiline
        submitBehavior="blurAndSubmit"
        style={s.title}
      />
      <TextInput
        value={description}
        onChangeText={setDescription}
        onEndEditing={() => {
          if (description !== (task.description ?? "")) save({ description });
        }}
        placeholder={t("tkDescriptionHint")}
        placeholderTextColor={theme.fgSubtle}
        accessibilityLabel={t("tkDescription")}
        maxLength={10_000}
        multiline
        style={s.description}
      />
    </Card>
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
  textCard: { gap: 6, paddingVertical: 10 },
  title: { color: theme.fg, fontSize: 18, fontWeight: "600", paddingVertical: 4 },
  description: { color: theme.fg, fontSize: 14, minHeight: 60, textAlignVertical: "top", paddingVertical: 4 },
  toggleRow: { minHeight: 56, flexDirection: "row", alignItems: "center", gap: 14, paddingHorizontal: 14 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  event: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10, paddingHorizontal: 14 },
  loading: { padding: 24, alignItems: "center" },
});
