import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { Task, Workspace } from "../hooks/useWorkspace";
import { AgentAvatar, Badge, EmptyState, Muted, Page, PageHeader, Segmented } from "../ui/components";
import { theme as t } from "../ui/theme";

type Filter = "all" | "task" | "commitment";
export function TasksPage({ data, open }: { data: Workspace; open: (threadId: string) => void }) {
  const [filter, setFilter] = useState<Filter>("all");
  const tasks = useMemo(
    () => data.tasks.filter((task) => filter === "all" || task.kind === filter),
    [data.tasks, filter],
  );
  const groups = [
    { id: "doing", title: "En curso", color: t.brand },
    { id: "pending", title: "Pendientes", color: t.subtle },
    { id: "review", title: "En revisión", color: t.info },
    { id: "blocked", title: "Bloqueadas", color: t.warning },
  ];
  return (
    <View style={s.root}>
      <PageHeader title="Tareas" />
      <Page>
        <Segmented
          value={filter}
          onChange={setFilter}
          options={[
            { value: "all", label: "Todas" },
            { value: "task", label: "Tareas" },
            { value: "commitment", label: "Compromisos" },
          ]}
        />
        {tasks.length ? (
          groups.map((group) => {
            const rows = tasks.filter((task) => classify(task) === group.id);
            if (!rows.length) return null;
            return (
              <View key={group.id}>
                <View style={s.group}>
                  <View style={[s.dot, { backgroundColor: group.color }]} />
                  <Muted>
                    {group.title} · {rows.length}
                  </Muted>
                </View>
                {rows.map((task) => (
                  <TaskRow key={task.id} task={task} data={data} onPress={() => open(task.thread_id)} />
                ))}
              </View>
            );
          })
        ) : (
          <EmptyState title="No hay tareas" body="Las tareas y compromisos aparecen acá." />
        )}
      </Page>
    </View>
  );
}
function classify(task: Task) {
  if (task.awaits_owner || task.status === "blocked") return "blocked";
  if (task.status === "review") return "review";
  if (task.status === "doing" || task.status === "running") return "doing";
  return "pending";
}
function TaskRow({ task, data, onPress }: { task: Task; data: Workspace; onPress: () => void }) {
  const agent = data.agents.find((item) => item.id === task.assignee);
  const project = data.projects.find((item) => item.id === task.project_id);
  return (
    <Pressable style={s.row} onPress={onPress}>
      <AgentAvatar
        name={agent?.name ?? task.assignee ?? "APX"}
        blob={agent?.blob}
        id={agent?.id ?? task.assignee}
        size={34}
      />
      <View style={{ flex: 1 }}>
        <View style={s.titleLine}>
          <Text style={s.title}>{task.title}</Text>
          {task.kind === "commitment" ? <Badge tone="violet">Compromiso</Badge> : null}
        </View>
        <Muted>
          {agent?.name ?? task.assignee ?? "APX"} · {project?.name ?? "Default"} · {due(task.due_at)}
        </Muted>
        {task.awaits_owner ? <Text style={s.waiting}>Espera tu respuesta</Text> : null}
      </View>
    </Pressable>
  );
}
function due(value?: string) {
  if (!value) return "Sin fecha";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("es", { weekday: "short", hour: "2-digit", minute: "2-digit" }).format(date);
}
const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: t.bg },
  group: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 21, marginBottom: 5 },
  dot: { width: 8, height: 8, borderRadius: 5 },
  row: { minHeight: 74, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 3 },
  titleLine: { flexDirection: "row", alignItems: "center", gap: 7 },
  title: { flex: 1, color: t.fg, fontSize: 14 },
  waiting: { color: t.warning, fontSize: 11, marginTop: 2 },
});
