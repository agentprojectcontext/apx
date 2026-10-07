import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { dueWhen } from "../format";
import { type TaskFilter, type TaskGroup, taskGroups } from "../hooks/taskGroups";
import type { Task, Workspace } from "../hooks/useWorkspace";
import { t } from "../i18n";
import { AgentAvatar, EmptyState, GroupLabel, PageTitle, Screen, Segmented, Tag, type } from "../ui/kit";
import { theme } from "../ui/theme";

const COLORS: Record<TaskGroup["id"], string> = {
  doing: theme.brand,
  pending: theme.fgSubtle,
  review: theme.info,
  blocked: theme.warning,
};

export function TasksPage({ data, open }: { data: Workspace; open: (threadId: string) => void }) {
  const [filter, setFilter] = useState<TaskFilter>("all");
  const groups = useMemo(() => taskGroups(data.tasks, filter), [data.tasks, filter]);
  return (
    <Screen
      inset={false}
      gap={8}
      header={
        <>
          <PageTitle title={t("navTasks")} inset />
          <Segmented
            value={filter}
            onChange={setFilter}
            style={{ marginHorizontal: 16, marginBottom: 4 }}
            options={[
              { value: "all", label: t("tasksAll") },
              { value: "task", label: t("tasksTasks") },
              { value: "commitment", label: t("tasksCommitments") },
            ]}
          />
        </>
      }
    >
      {groups.length ? (
        groups.map((group) => (
          <View key={group.id}>
            <GroupLabel label={`${t(group.label)} · ${group.tasks.length}`} color={COLORS[group.id]} />
            {group.tasks.map((task) => (
              <TaskRow key={task.id} task={task} data={data} onPress={() => open(task.thread_id)} />
            ))}
          </View>
        ))
      ) : (
        <EmptyState title={t("noTasks")} body={t("noTasksBody")} icon="ListChecks" />
      )}
    </Screen>
  );
}

function TaskRow({ task, data, onPress }: { task: Task; data: Workspace; onPress: () => void }) {
  const agent = data.agents.find((item) => item.id === task.assignee);
  const project = data.projects.find((item) => item.id === task.project_id)?.name ?? t("defaultProject");
  const who = agent?.name ?? task.assignee ?? "APX";
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [s.row, pressed && { backgroundColor: theme.fill }]}
    >
      <AgentAvatar name={who} blob={agent?.blob} id={agent?.id ?? task.assignee} size={36} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={type.rowTitle}>{task.title}</Text>
        <Text numberOfLines={1} style={type.meta}>
          {[who, project, task.due_at && dueWhen(task.due_at)].filter(Boolean).join(" · ")}
        </Text>
        {task.awaits_owner ? <Text style={s.note}>{t("waitsForYourAnswer")}</Text> : null}
      </View>
      {task.kind === "commitment" ? <Tag tone="violet">{t("commitment")}</Tag> : null}
    </Pressable>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 14, paddingVertical: 10, paddingHorizontal: 20 },
  note: { color: theme.warning, fontSize: 12 },
});
