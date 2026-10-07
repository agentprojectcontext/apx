import { useMemo, useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { elapsed, listWhen } from "../format";
import { isWorking, listedThreads, threadContext, workingNow } from "../hooks/chatSelectors";
import type { Agent, Job, Thread, Workspace } from "../hooks/useWorkspace";
import { t } from "../i18n";
import { EngineIcon } from "../ui/EngineIcon";
import { Icon } from "../ui/Icon";
import {
  AgentAvatar,
  AgentPair,
  Chip,
  CountBadge,
  EmptyState,
  Fab,
  IconButton,
  OwnerAvatar,
  Spinner,
  type,
} from "../ui/kit";
import { theme } from "../ui/theme";

export function ChatsPage({
  data,
  online,
  open,
  create,
  account,
  refresh,
  project,
  setProject,
}: {
  data: Workspace;
  online: boolean;
  open: (thread: Thread) => void;
  create: () => void;
  account: () => void;
  refresh: () => Promise<void>;
  /** The project filter ("all", "default" or a project id), kept by the workspace so other pages can set it. */
  project: string;
  setProject: (project: string) => void;
}) {
  const [query, setQuery] = useState<string>();
  const [refreshing, setRefreshing] = useState(false);
  const working = useMemo(() => workingNow(data.threads, data.jobs.running), [data.threads, data.jobs.running]);
  const rows = listedThreads(data.threads).filter((thread) => {
    const inProject = project === "all" || (project === "default" ? !thread.project_id : thread.project_id === project);
    const words = query?.trim().toLowerCase();
    return inProject && (!words || `${thread.title} ${thread.preview}`.toLowerCase().includes(words));
  });
  const projects = data.projects.filter((item) => item.registered !== false);
  return (
    <View style={s.root}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: 96 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            tintColor={theme.fgMuted}
            colors={[theme.fg]}
            progressBackgroundColor={theme.surfaceRaised}
            onRefresh={() => {
              setRefreshing(true);
              void refresh().finally(() => setRefreshing(false));
            }}
          />
        }
      >
        <View style={s.header}>
          <Text accessibilityRole="header" style={[type.largeTitle, { flex: 1 }]}>
            {t("navChats")}
          </Text>
          <IconButton
            icon="Search"
            label={t("searchChats")}
            onPress={() => setQuery((q) => (q === undefined ? "" : undefined))}
          />
          <Pressable accessibilityRole="button" accessibilityLabel={t("navMore")} onPress={account} style={s.account}>
            <OwnerAvatar name={data.owner} online={online} />
          </Pressable>
        </View>
        {query !== undefined ? (
          <View style={s.search}>
            <Icon name="Search" size={16} color={theme.fgSubtle} />
            <TextInput
              autoFocus
              value={query}
              onChangeText={setQuery}
              placeholder={t("searchChats")}
              placeholderTextColor={theme.fgSubtle}
              returnKeyType="search"
              style={s.searchInput}
            />
            <IconButton
              icon="X"
              label={t("back")}
              size={16}
              color={theme.fgMuted}
              onPress={() => setQuery(undefined)}
            />
          </View>
        ) : null}
        {working.length > 0 ? (
          <>
            <Text style={[type.meta, s.workingLabel]}>{t("workingNow", { n: working.length })}</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.strip}>
              {working.map(({ thread, job }) => (
                <WorkChip key={thread.id} thread={thread} job={job} agents={data.agents} onPress={() => open(thread)} />
              ))}
            </ScrollView>
          </>
        ) : null}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chips}>
          <Chip label={t("all")} selected={project === "all"} onPress={() => setProject("all")} />
          <Chip label={t("defaultProject")} selected={project === "default"} onPress={() => setProject("default")} />
          {projects.map((item) => (
            <Chip key={item.id} label={item.name} selected={project === item.id} onPress={() => setProject(item.id)} />
          ))}
        </ScrollView>
        {rows.length ? (
          rows.map((thread) => <ChatRow key={thread.id} thread={thread} data={data} onPress={() => open(thread)} />)
        ) : (
          <EmptyState title={t("noChats")} body={t("noChatsBody")} icon="MessageCircle" />
        )}
      </ScrollView>
      <Fab icon="SquarePen" label={t("newChat")} onPress={create} />
    </View>
  );
}

const agentOf = (id: string | undefined, agents: Agent[]) => agents.find((agent) => agent.id === id);

/** A conversation's face: the outside engine's mark, two agents for a group, or its agent. */
function ThreadAvatar({ thread, agents, size }: { thread: Thread; agents: Agent[]; size: number }) {
  if (thread.engine === "claude" || thread.engine === "codex") return <EngineIcon engine={thread.engine} size={size} />;
  const [a, b] = thread.agent_ids.map((id) => agentOf(id, agents) ?? { id, name: id });
  if (a && b) return <AgentPair first={a} second={b} size={size + 4} />;
  return <AgentAvatar name={a?.name ?? thread.title} blob={a?.blob} id={a?.id} size={size} />;
}

function WorkChip({
  thread,
  job,
  agents,
  onPress,
}: {
  thread: Thread;
  job?: Job;
  agents: Agent[];
  onPress: () => void;
}) {
  const who = agentOf(job?.agent_id ?? thread.agent_ids[0], agents)?.name ?? thread.title;
  const waiting = thread.state === "input-required";
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [s.work, pressed && { opacity: 0.85 }]}
    >
      <ThreadAvatar thread={thread} agents={agents} size={32} />
      <View style={{ maxWidth: 160 }}>
        <Text numberOfLines={1} style={s.workTitle}>
          {job?.title || thread.title}
        </Text>
        <Text numberOfLines={1} style={type.small}>
          {who} · {waiting ? t("waitsForYou") : elapsed(job?.started_at ?? thread.updated_at)}
        </Text>
      </View>
      {waiting ? <Icon name="Bell" size={14} color={theme.warning} /> : <Spinner size={14} />}
    </Pressable>
  );
}

function ChatRow({ thread, data, onPress }: { thread: Thread; data: Workspace; onPress: () => void }) {
  const unread = thread.unread > 0;
  const busy = isWorking(thread.state);
  const waiting = thread.state === "input-required";
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [s.row, pressed && { backgroundColor: theme.fill }]}
    >
      <View style={s.avatar}>
        <ThreadAvatar thread={thread} agents={data.agents} size={44} />
      </View>
      <View style={s.copy}>
        <View style={s.line}>
          <Text numberOfLines={1} style={[s.title, unread && { fontWeight: "600" }]}>
            {thread.title}
          </Text>
          {busy ? <Spinner size={12} /> : null}
          <Text style={[type.meta, unread && { color: theme.brand }, waiting && { color: theme.warning }]}>
            {busy ? t("working") : waiting ? t("waitsForYou") : listWhen(thread.updated_at)}
          </Text>
        </View>
        <View style={s.line}>
          <Text numberOfLines={1} style={[s.preview, unread && { color: theme.fg }]}>
            {thread.preview || t("noMessagesYet")}
          </Text>
          {unread ? <CountBadge count={thread.unread} /> : null}
        </View>
        <Text numberOfLines={1} style={type.small}>
          {threadContext(thread, data)}
        </Text>
      </View>
    </Pressable>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg },
  header: { height: 60, flexDirection: "row", alignItems: "center", gap: 8, paddingLeft: 20, paddingRight: 8 },
  account: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  search: {
    height: 40,
    marginHorizontal: 16,
    marginBottom: 8,
    paddingLeft: 14,
    borderRadius: 999,
    backgroundColor: theme.fill,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  searchInput: { flex: 1, color: theme.fg, fontSize: 15, paddingVertical: 0 },
  workingLabel: { paddingTop: 4, paddingHorizontal: 20, paddingBottom: 8 },
  strip: { gap: 8, paddingHorizontal: 16, paddingBottom: 12 },
  work: {
    height: 52,
    paddingLeft: 8,
    paddingRight: 14,
    borderRadius: 999,
    backgroundColor: theme.fill,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  workTitle: { color: theme.fg, fontSize: 13, fontWeight: "500" },
  chips: { gap: 8, paddingHorizontal: 16, paddingBottom: 8 },
  row: { flexDirection: "row", alignItems: "center", gap: 14, paddingVertical: 10, paddingHorizontal: 20 },
  avatar: { width: 48, height: 48, alignItems: "center", justifyContent: "center" },
  copy: { flex: 1, minWidth: 0, gap: 2 },
  line: { flexDirection: "row", alignItems: "center", gap: 8 },
  title: { flex: 1, color: theme.fg, fontSize: 15, fontWeight: "500" },
  preview: { flex: 1, color: theme.fgMuted, fontSize: 13 },
});
