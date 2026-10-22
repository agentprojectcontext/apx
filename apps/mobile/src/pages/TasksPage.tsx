import { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { dueWhen } from "../format";
import { closedTasks, type TaskFilter, type TaskGroup, taskGroups } from "../hooks/taskGroups";
import type { Task, Workspace } from "../hooks/useWorkspace";
import { t } from "../i18n";
import { type TaskActions, TaskMenu } from "../tasks/TaskMenu";
import { Icon } from "../ui/Icon";
import { AgentAvatar, EmptyState, Fab, GroupLabel, PageTitle, Screen, Segmented, Tag, useType } from "../ui/kit";
import { type ColorKey, makeStyles, useTheme } from "../ui/theme";

const COLORS: Record<TaskGroup["id"], ColorKey> = {
  proposed: "info",
  doing: "brand",
  pending: "fgSubtle",
  review: "info",
  blocked: "warning",
};

/**
 * Open tasks by group, then the latest closed ones folded; a task opens its page, a long press its options, the
 * button makes a new one.
 */
export function TasksPage({
  data,
  actions,
  open,
  create,
  openThread,
}: {
  data: Workspace;
  actions: TaskActions;
  open: (task: Task) => void;
  create: () => void;
  openThread: (id: string) => void;
}) {
  const theme = useTheme();
  const s = useStyles();
  const [filter, setFilter] = useState<TaskFilter>("all");
  const [menu, setMenu] = useState<string>();
  const menuTask = data.tasks.find((item) => item.id === menu);
  const [showClosed, setShowClosed] = useState(false);
  const groups = useMemo(() => taskGroups(data.tasks, filter), [data.tasks, filter]);
  const closed = useMemo(() => closedTasks(data.tasks, filter), [data.tasks, filter]);
  return (
    <View style={{ flex: 1 }}>
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
              <GroupLabel label={`${t(group.label)} · ${group.tasks.length}`} color={theme[COLORS[group.id]]} />
              {group.tasks.map((task) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  data={data}
                  onPress={() => open(task)}
                  onMenu={() => setMenu(task.id)}
                />
              ))}
            </View>
          ))
        ) : (
          <EmptyState title={t("noTasks")} body={t("noTasksBody")} icon="ListChecks" />
        )}
        {closed.length ? (
          <View>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ expanded: showClosed }}
              onPress={() => setShowClosed(!showClosed)}
              style={s.closedLabel}
            >
              <GroupLabel label={`${t("tkClosed")} · ${closed.length}`} color={theme.fgSubtle} inset={0} />
              <Icon name={showClosed ? "ChevronDown" : "ChevronRight"} size={14} color={theme.fgSubtle} />
            </Pressable>
            {showClosed
              ? closed.map((task) => (
                  <TaskRow
                    key={task.id}
                    task={task}
                    data={data}
                    onPress={() => open(task)}
                    onMenu={() => setMenu(task.id)}
                  />
                ))
              : null}
          </View>
        ) : null}
      </Screen>
      <Fab icon="Plus" label={t("tkNew")} onPress={create} />
      {menuTask ? (
        <TaskMenu
          task={menuTask}
          data={data}
          actions={actions}
          onClose={() => setMenu(undefined)}
          onOpen={() => open(menuTask)}
          openThread={openThread}
        />
      ) : null}
    </View>
  );
}

function TaskRow({
  task,
  data,
  onPress,
  onMenu,
}: {
  task: Task;
  data: Workspace;
  onPress: () => void;
  onMenu: () => void;
}) {
  const type = useType();
  const theme = useTheme();
  const s = useStyles();
  const agent = data.agents.find((item) => item.id === task.assignee);
  const project = data.projects.find((item) => item.id === task.project_id)?.name ?? t("defaultProject");
  const who = agent?.name ?? task.assignee ?? "APX";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityActions={[{ name: "longpress", label: t("tkMore") }]}
      onAccessibilityAction={(event) => event.nativeEvent.actionName === "longpress" && onMenu()}
      onPress={onPress}
      onLongPress={onMenu}
      delayLongPress={350}
      style={({ pressed }) => [s.row, pressed && { backgroundColor: theme.fill }]}
    >
      <AgentAvatar name={who} blob={agent?.blob} id={agent?.id ?? task.assignee} size={36} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[type.rowTitle, task.state !== "open" && s.closedTitle]}>{task.title}</Text>
        <Text numberOfLines={1} style={type.meta}>
          {[who, project, task.due_at && dueWhen(task.due_at)].filter(Boolean).join(" · ")}
        </Text>
        {task.awaits_owner ? <Text style={s.note}>{t("waitsForYourAnswer")}</Text> : null}
      </View>
      {task.kind === "commitment" ? <Tag tone="violet">{t("commitment")}</Tag> : null}
    </Pressable>
  );
}

const useStyles = makeStyles((theme) => ({
  closedLabel: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 20, paddingBottom: 72 },
  closedTitle: { color: theme.fgMuted, textDecorationLine: "line-through" },
  row: { flexDirection: "row", alignItems: "center", gap: 14, paddingVertical: 10, paddingHorizontal: 20 },
  note: { color: theme.warning, fontSize: 12 },
}));
