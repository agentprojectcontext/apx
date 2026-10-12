import { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { sentenceCase } from "../format";
import { isWorking, listedThreads, pickAgents } from "../hooks/chatSelectors";
import type { Agent, Thread, Workspace } from "../hooks/useWorkspace";
import { t } from "../i18n";
import { Icon } from "./Icon";
import { AgentAvatar, BottomSheet, Chip, GroupLabel, Spinner, type } from "./kit";
import { theme } from "./theme";

/** Starts a chat with an agent of a project, or jumps to another chat. */
export function ChatPicker({
  data,
  mode,
  onClose,
  onOpen,
  onCreate,
}: {
  data: Workspace;
  mode: "switch" | "new";
  onClose: () => void;
  onOpen: (thread: Thread) => void;
  onCreate: (agent: Agent, projectId?: string) => Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const [project, setProject] = useState<string>();
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState("");
  const words = query.trim().toLowerCase();
  const projectName = (id: string) => data.projects.find((item) => item.id === id)?.name ?? t("defaultProject");
  const agents = useMemo(() => {
    const names = new Map(data.projects.map((item) => [item.id, item.name]));
    return pickAgents(data.agents, data.threads, {
      projectId: project,
      query,
      projectName: (id) => names.get(id) ?? t("defaultProject"),
    });
  }, [data.agents, data.threads, data.projects, project, query]);
  const threads = useMemo(
    () =>
      listedThreads(data.threads)
        .filter(
          (thread) =>
            (!project || thread.project_id === project) &&
            `${thread.title} ${thread.preview}`.toLowerCase().includes(words),
        )
        .slice(0, 60),
    [data.threads, project, words],
  );
  const create = async (agent: Agent) => {
    setBusy(agent.id);
    setError("");
    try {
      // With no project picked, the chat goes to the agent's own project.
      await onCreate(agent, project ?? agent.project_id);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(undefined);
    }
  };
  const agentRow = (agent: Agent) => {
    const role =
      agent.kind === "secretary" ? t("superAgent") : sentenceCase(agent.role || agent.description) || t("agent");
    return (
      <Row
        key={agent.id}
        title={agent.name}
        sub={!project && agent.project_id ? `${projectName(agent.project_id)} · ${role}` : role}
        avatar={<AgentAvatar name={agent.name} blob={agent.blob} id={agent.id} size={36} />}
        trailing={busy === agent.id ? <Spinner size={16} /> : <Icon name="Plus" size={18} color={theme.fgMuted} />}
        disabled={Boolean(busy)}
        onPress={() => void create(agent)}
      />
    );
  };
  return (
    <BottomSheet title={t(mode === "new" ? "newChat" : "switchChat")} onClose={onClose}>
      <View style={s.search}>
        <Icon name="Search" size={16} color={theme.fgSubtle} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder={t(mode === "new" ? "searchAgents" : "searchChats")}
          placeholderTextColor={theme.fgSubtle}
          style={s.input}
        />
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chips}>
        <Chip label={t("all")} selected={!project} onPress={() => setProject(undefined)} />
        {data.projects
          .filter((item) => item.registered !== false)
          .map((item) => (
            <Chip key={item.id} label={item.name} selected={project === item.id} onPress={() => setProject(item.id)} />
          ))}
      </ScrollView>
      {error ? <Text style={s.error}>{error}</Text> : null}
      {mode === "new" ? (
        agents.recent.length || agents.rest.length ? (
          <>
            {agents.recent.length ? <GroupLabel label={t("recentAgents")} inset={12} /> : null}
            {agents.recent.map(agentRow)}
            {agents.recent.length && agents.rest.length ? <GroupLabel label={t("agents")} inset={12} /> : null}
            {agents.rest.map(agentRow)}
          </>
        ) : (
          <Text style={[type.muted, s.empty]}>{t(words ? "noAgentsMatch" : "noAgentsHere")}</Text>
        )
      ) : (
        threads.map((thread) => {
          const agent = data.agents.find((entry) => entry.id === thread.agent_ids[0]);
          return (
            <Row
              key={thread.id}
              title={thread.title}
              sub={thread.preview}
              avatar={<AgentAvatar name={agent?.name ?? thread.title} blob={agent?.blob} id={agent?.id} size={36} />}
              trailing={
                isWorking(thread.state) ? (
                  <Spinner size={14} />
                ) : (
                  <Icon name="ChevronRight" size={16} color={theme.fgSubtle} />
                )
              }
              onPress={() => {
                onOpen(thread);
                onClose();
              }}
            />
          );
        })
      )}
    </BottomSheet>
  );
}

function Row({
  title,
  sub,
  avatar,
  trailing,
  disabled,
  onPress,
}: {
  title: string;
  sub?: string;
  avatar: React.ReactNode;
  trailing: React.ReactNode;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [s.row, pressed && { backgroundColor: theme.fill }]}
    >
      {avatar}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={s.rowTitle}>
          {title}
        </Text>
        {sub ? (
          <Text numberOfLines={1} style={type.meta}>
            {sub}
          </Text>
        ) : null}
      </View>
      {trailing}
    </Pressable>
  );
}

const s = StyleSheet.create({
  search: {
    height: 40,
    marginHorizontal: 4,
    paddingHorizontal: 14,
    borderRadius: 20,
    backgroundColor: theme.fill,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  input: { flex: 1, color: theme.fg, fontSize: 15, paddingVertical: 0 },
  chips: { gap: 8, paddingHorizontal: 4, paddingVertical: 12 },
  row: { minHeight: 60, flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 12, borderRadius: 14 },
  rowTitle: { color: theme.fg, fontSize: 15, fontWeight: "500" },
  empty: { padding: 24, textAlign: "center" },
  error: { color: theme.danger, fontSize: 13, paddingHorizontal: 12, paddingBottom: 8 },
});
