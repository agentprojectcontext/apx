import { useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { activeThreads, isWorking, listedThreads } from "../hooks/chatSelectors";
import type { Agent, Thread, Workspace } from "../hooks/useWorkspace";
import { AgentAvatar, Badge, EmptyState, IconButton, Muted, Page, PageHeader, RoundButton } from "../ui/components";
import { Icon } from "../ui/Icon";
import { theme as t } from "../ui/theme";

export function ChatsPage({
  data,
  open,
  create,
}: {
  data: Workspace;
  open: (thread: Thread) => void;
  create: () => void;
}) {
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const searchInput = useRef<TextInput>(null);
  const [project, setProject] = useState("all");
  const busy = useMemo(
    () => new Set(data.threads.filter((thread) => isWorking(thread.state)).map((thread) => thread.id)),
    [data.threads],
  );
  const filtered = listedThreads(data.threads).filter((thread) => {
    const matchesProject =
      project === "all" || (project === "default" ? !thread.project_id : thread.project_id === project);
    const matchesQuery = `${thread.title} ${thread.preview}`.toLowerCase().includes(query.toLowerCase());
    return matchesProject && matchesQuery;
  });
  const working = activeThreads(data.threads);
  return (
    <View style={s.root}>
      <PageHeader
        title="Chats"
        right={
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <IconButton
              icon="Search"
              label="Buscar chats"
              onPress={() => {
                setSearching((value) => !value);
                setTimeout(() => searchInput.current?.focus(), 100);
              }}
            />
            <Text style={s.profile}>MD</Text>
          </View>
        }
      />
      <Page>
        {searching ? (
          <View style={s.searchRow}>
            <Icon name="Search" size={18} />
            <TextInput
              ref={searchInput}
              value={query}
              onChangeText={setQuery}
              placeholder="Buscar chats"
              placeholderTextColor={t.subtle}
              style={s.search}
            />
            <Muted>{data.threads.length}</Muted>
          </View>
        ) : null}
        {working.length > 0 ? (
          <View style={s.section}>
            <Muted>Trabajando ahora · {working.length}</Muted>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.horizontal}>
              {working.map((thread) => (
                <ThreadChip key={thread.id} thread={thread} data={data} onPress={() => open(thread)} />
              ))}
            </ScrollView>
          </View>
        ) : null}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{ flexGrow: 0 }}
          contentContainerStyle={s.projects}
        >
          <Pressable onPress={() => setProject("all")} style={[s.projectPill, project === "all" && s.selected]}>
            <Text style={[s.projectText, project === "all" && s.selectedText]}>Todos</Text>
          </Pressable>
          <Pressable onPress={() => setProject("default")} style={[s.projectPill, project === "default" && s.selected]}>
            <Text style={[s.projectText, project === "default" && s.selectedText]}>Default</Text>
          </Pressable>
          {data.projects
            .filter((item) => item.registered !== false)
            .map((item) => (
              <Pressable
                key={item.id}
                onPress={() => setProject(item.id)}
                style={[s.projectPill, project === item.id && s.selected]}
              >
                <Text style={[s.projectText, project === item.id && s.selectedText]} numberOfLines={1}>
                  {item.name}
                </Text>
              </Pressable>
            ))}
        </ScrollView>
        {filtered.length ? (
          filtered.map((thread) => (
            <ThreadRow
              key={thread.id}
              thread={thread}
              data={data}
              busy={busy.has(thread.id)}
              onPress={() => open(thread)}
            />
          ))
        ) : (
          <EmptyState title="No hay chats" body="Probá otro filtro o empezá una conversación." />
        )}
      </Page>
      <View style={s.fab}>
        <RoundButton icon="SquarePen" label="Nuevo chat" onPress={create} />
      </View>
    </View>
  );
}

function ThreadChip({ thread, data, onPress }: { thread: Thread; data: Workspace; onPress: () => void }) {
  const agent = findAgent(thread, data.agents);
  return (
    <Pressable onPress={onPress} style={s.workChip}>
      <AgentAvatar name={agent?.name ?? thread.title} blob={agent?.blob} id={agent?.id ?? thread.agent_ids[0]} />
      <View style={{ flex: 1 }}>
        <Text style={s.rowTitle} numberOfLines={1}>
          {thread.title}
        </Text>
        <Muted numberOfLines={1}>
          {thread.state === "input-required" ? "Espera tu respuesta" : "Trabajando ahora"}
        </Muted>
      </View>
    </Pressable>
  );
}
function ThreadRow({
  thread,
  data,
  busy,
  onPress,
}: {
  thread: Thread;
  data: Workspace;
  busy: boolean;
  onPress: () => void;
}) {
  const agent = findAgent(thread, data.agents);
  const project = data.projects.find((item) => item.id === thread.project_id);
  return (
    <Pressable onPress={onPress} style={s.threadRow}>
      <AgentAvatar
        name={agent?.name ?? thread.title}
        blob={agent?.blob}
        id={agent?.id ?? thread.agent_ids[0]}
        size={36}
      />
      <View style={s.copy}>
        <View style={s.top}>
          <Text style={s.rowTitle} numberOfLines={1}>
            {thread.title}
          </Text>
          {busy ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
              <ActivityIndicator size="small" color={t.brand} />
              <Muted>Trabajando</Muted>
            </View>
          ) : (
            <Muted>{thread.state === "input-required" ? "Te necesita" : time(thread.updated_at)}</Muted>
          )}
        </View>
        <Text style={s.preview} numberOfLines={1}>
          {thread.preview || "Todavía no hay mensajes."}
        </Text>
        <Muted numberOfLines={1}>
          {project?.name ?? "Default"} · {thread.engine ?? "Web"}
        </Muted>
      </View>
      {thread.unread > 0 ? <Badge tone="brand">{String(thread.unread)}</Badge> : null}
    </Pressable>
  );
}
function findAgent(thread: Thread, agents: Agent[]) {
  return agents.find((agent) => agent.id === thread.agent_ids[0]);
}
function time(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ""
    : new Intl.DateTimeFormat("es", { hour: "2-digit", minute: "2-digit" }).format(date);
}
const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: t.bg },
  searchRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 9 },
  search: {
    flex: 1,
    color: t.fg,
    height: 38,
    borderRadius: 20,
    backgroundColor: t.fill,
    paddingHorizontal: 14,
    fontSize: 14,
  },
  section: { paddingTop: 8, paddingBottom: 12, borderBottomWidth: 1, borderColor: t.border },
  horizontal: { flexDirection: "row", gap: 8, paddingTop: 9 },
  workChip: {
    width: 200,
    minHeight: 62,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    padding: 10,
    borderRadius: 28,
    backgroundColor: t.surface,
  },
  projects: { flexDirection: "row", gap: 7, paddingVertical: 10 },
  projectPill: {
    borderRadius: 99,
    borderWidth: 1,
    borderColor: t.borderStrong,
    paddingHorizontal: 13,
    paddingVertical: 7,
    maxWidth: 130,
  },
  selected: { backgroundColor: t.accent, borderColor: t.accent },
  projectText: { color: t.muted, fontSize: 12 },
  selectedText: { color: t.accentFg },
  threadRow: {
    minHeight: 76,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 2,
  },
  copy: { flex: 1, minWidth: 0, gap: 3 },
  top: { flexDirection: "row", alignItems: "center", gap: 8 },
  rowTitle: { color: t.fg, fontSize: 15, fontWeight: "500", flex: 1 },
  preview: { color: t.fg, fontSize: 13 },
  fab: { position: "absolute", right: 20, bottom: 16 },
  profile: {
    color: t.violet,
    backgroundColor: t.violetSoft,
    width: 34,
    height: 34,
    textAlign: "center",
    textAlignVertical: "center",
    borderRadius: 18,
    overflow: "hidden",
    fontSize: 12,
    fontWeight: "600",
  },
});
