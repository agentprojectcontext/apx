import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { chatAgents, isWorking, listedThreads } from "../hooks/chatSelectors";
import type { Agent, Thread, Workspace } from "../hooks/useWorkspace";
import { AgentAvatar, IconButton, Muted } from "./components";
import { Icon } from "./Icon";
import { theme as t } from "./theme";

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
  const agents = useMemo(
    () =>
      chatAgents(data.agents, project).filter((agent) =>
        `${agent.name} ${agent.description ?? ""}`.toLowerCase().includes(query.toLowerCase()),
      ),
    [data.agents, project, query],
  );
  const threads = useMemo(
    () =>
      listedThreads(data.threads).filter(
        (thread) =>
          (!project || thread.project_id === project) &&
          `${thread.title} ${thread.preview}`.toLowerCase().includes(query.toLowerCase()),
      ),
    [data.threads, project, query],
  );
  const create = async (agent: Agent) => {
    setBusy(agent.id);
    setError("");
    try {
      await onCreate(agent, project);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(undefined);
    }
  };
  return (
    <Modal transparent animationType="slide" onRequestClose={onClose}>
      <View style={s.overlay}>
        <Pressable style={s.backdrop} onPress={onClose} accessibilityLabel="Cerrar selector" />
        <View style={s.sheet}>
          <View style={s.handle} />
          <View style={s.heading}>
            <Text style={s.title}>{mode === "new" ? "Nuevo chat" : "Cambiar chat"}</Text>
            <IconButton icon="ChevronDown" label="Cerrar" onPress={onClose} />
          </View>
          <View style={s.search}>
            <Icon name="Search" size={18} />
            <TextInput
              autoFocus
              value={query}
              onChangeText={setQuery}
              style={s.input}
              placeholder={mode === "new" ? "Buscar agente" : "Buscar conversación"}
              placeholderTextColor={t.subtle}
            />
          </View>
          <ScrollView
            horizontal
            style={{ flexGrow: 0, flexShrink: 0, height: 58 }}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={s.projects}
          >
            <Pressable onPress={() => setProject(undefined)} style={[s.pill, !project && s.selected]}>
              <Text style={[s.pillText, !project && s.selectedText]}>{mode === "new" ? "Default" : "Todos"}</Text>
            </Pressable>
            {data.projects
              .filter((item) => item.registered !== false)
              .map((item) => (
                <Pressable
                  key={item.id}
                  onPress={() => setProject(item.id)}
                  style={[s.pill, project === item.id && s.selected]}
                >
                  <Text style={[s.pillText, project === item.id && s.selectedText]}>{item.name}</Text>
                </Pressable>
              ))}
          </ScrollView>
          {error ? <Text style={s.error}>{error}</Text> : null}
          {mode === "new" ? (
            <FlatList
              data={agents}
              keyExtractor={(agent) => agent.id}
              keyboardShouldPersistTaps="handled"
              ListEmptyComponent={<Muted style={s.empty}>No hay agentes para este proyecto.</Muted>}
              renderItem={({ item }) => (
                <Pressable disabled={Boolean(busy)} style={s.row} onPress={() => void create(item)}>
                  <AgentAvatar name={item.name} blob={item.blob} id={item.id} size={36} />
                  <View style={s.copy}>
                    <Text style={s.rowTitle}>{item.name}</Text>
                    <Muted numberOfLines={1}>
                      {item.kind === "secretary" ? "Superagente" : item.role || item.description || "Agente"}
                    </Muted>
                  </View>
                  {busy === item.id ? <ActivityIndicator color={t.brand} /> : <Icon name="Plus" size={18} />}
                </Pressable>
              )}
            />
          ) : (
            <FlatList
              data={threads}
              keyExtractor={(thread) => thread.id}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item }) => {
                const agent = data.agents.find((entry) => entry.id === item.agent_ids[0]);
                return (
                  <Pressable
                    style={s.row}
                    onPress={() => {
                      onOpen(item);
                      onClose();
                    }}
                  >
                    <AgentAvatar
                      name={agent?.name ?? item.title}
                      blob={agent?.blob}
                      id={agent?.id ?? item.agent_ids[0]}
                      size={36}
                    />
                    <View style={s.copy}>
                      <Text style={s.rowTitle} numberOfLines={1}>
                        {item.title}
                      </Text>
                      <Muted numberOfLines={1}>{item.preview}</Muted>
                    </View>
                    {isWorking(item.state) ? (
                      <ActivityIndicator size="small" color={t.brand} />
                    ) : (
                      <Icon name="ChevronRight" size={18} />
                    )}
                  </Pressable>
                );
              }}
            />
          )}
        </View>
      </View>
    </Modal>
  );
}
const s = StyleSheet.create({
  overlay: { flex: 1, justifyContent: "flex-end", backgroundColor: "#0008" },
  backdrop: { flex: 1 },
  sheet: {
    height: "76%",
    backgroundColor: t.bg,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    borderColor: t.border,
    paddingHorizontal: 20,
    paddingBottom: 24,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 4,
    backgroundColor: t.borderStrong,
    alignSelf: "center",
    marginTop: 10,
  },
  heading: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 8 },
  title: { color: t.fg, fontSize: 21, fontWeight: "600" },
  search: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    height: 42,
    paddingHorizontal: 12,
    backgroundColor: t.fill,
    borderRadius: 14,
    marginTop: 8,
  },
  input: { color: t.fg, fontSize: 14, flex: 1 },
  projects: { gap: 7, paddingVertical: 12, alignItems: "center" },
  pill: {
    borderWidth: 1,
    borderColor: t.borderStrong,
    borderRadius: 18,
    paddingHorizontal: 12,
    height: 34,
    justifyContent: "center",
  },
  pillText: { color: t.muted, fontSize: 12 },
  selected: { backgroundColor: t.accent, borderColor: t.accent },
  selectedText: { color: t.accentFg },
  row: {
    minHeight: 66,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: t.border,
  },
  copy: { flex: 1, gap: 3 },
  rowTitle: { color: t.fg, fontSize: 14, fontWeight: "500" },
  empty: { paddingVertical: 32, textAlign: "center" },
  error: { color: t.danger, paddingVertical: 10 },
});
