import { useMemo, useState } from "react";
import { Pressable, RefreshControl, ScrollView, Text, TextInput, View } from "react-native";
import { elapsed, listWhen } from "../format";
import {
  bundleTasks,
  chatPreview,
  chatTitle,
  inboxThreads,
  isWorking,
  threadContext,
  workingNow,
  workSubject,
} from "../hooks/chatSelectors";
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
  useType,
} from "../ui/kit";
import { makeStyles, useTheme } from "../ui/theme";

export function ChatsPage({
  data,
  online,
  open,
  create,
  account,
  refresh,
  project,
  setProject,
  routines,
  setRoutines,
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
  /** Routine runs that told something are listed too; the clock in the header turns them off. */
  routines: boolean;
  setRoutines: (on: boolean) => void;
}) {
  const type = useType();
  const theme = useTheme();
  const s = useStyles();
  const [query, setQuery] = useState<string>();
  const [refreshing, setRefreshing] = useState(false);
  const working = useMemo(() => workingNow(data.threads, data.jobs.running), [data.threads, data.jobs.running]);
  const rows = inboxThreads(data.threads, routines).filter((thread) => {
    const inProject = project === "all" || (project === "default" ? !thread.project_id : thread.project_id === project);
    const words = query?.trim().toLowerCase();
    return inProject && (!words || `${thread.title} ${thread.preview}`.toLowerCase().includes(words));
  });
  const projects = data.projects.filter((item) => item.registered !== false);
  return (
    <View style={s.root}>
      {/* Title, search and filters stay put; only the list under them scrolls. */}
      <View style={s.header}>
        <Text accessibilityRole="header" style={[type.largeTitle, { flex: 1 }]}>
          {t("navChats")}
        </Text>
        <IconButton
          icon="Clock"
          label={t(routines ? "hideRoutines" : "showRoutines")}
          color={routines ? theme.fg : theme.fgSubtle}
          style={routines ? { backgroundColor: theme.fill } : undefined}
          onPress={() => setRoutines(!routines)}
        />
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
          <IconButton icon="X" label={t("back")} size={16} color={theme.fgMuted} onPress={() => setQuery(undefined)} />
        </View>
      ) : null}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={{ flexGrow: 0 }}
        contentContainerStyle={s.chips}
      >
        <Chip label={t("all")} selected={project === "all"} onPress={() => setProject("all")} />
        <Chip label={t("defaultProject")} selected={project === "default"} onPress={() => setProject("default")} />
        {projects.map((item) => (
          <Chip key={item.id} label={item.name} selected={project === item.id} onPress={() => setProject(item.id)} />
        ))}
      </ScrollView>
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
        {working.length > 0 ? (
          <>
            <Text style={[type.meta, s.workingLabel]}>{t("workingNow", { n: working.length })}</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.strip}>
              {working.map(({ thread, job }) => (
                <WorkChip key={thread.id} thread={thread} job={job} data={data} onPress={() => open(thread)} />
              ))}
            </ScrollView>
          </>
        ) : null}
        {rows.length ? (
          bundleTasks(rows).map((entry) =>
            entry.kind === "task" ? (
              <TaskRow key={entry.taskId} taskId={entry.taskId} threads={entry.threads} data={data} open={open} />
            ) : (
              <ChatRow key={entry.thread.id} thread={entry.thread} data={data} onPress={() => open(entry.thread)} />
            ),
          )
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

function WorkChip({ thread, job, data, onPress }: { thread: Thread; job?: Job; data: Workspace; onPress: () => void }) {
  const agents = data.agents;
  const type = useType();
  const theme = useTheme();
  const s = useStyles();
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
          {who}
        </Text>
        <Text numberOfLines={1} style={type.small}>
          {workSubject(thread, who, data)} ·{" "}
          {waiting ? t("waitsForYou") : (job?.activity ?? elapsed(job?.started_at ?? thread.updated_at))}
        </Text>
      </View>
      {waiting ? <Icon name="Bell" size={14} color={theme.warning} /> : <Spinner size={14} />}
    </Pressable>
  );
}

/** Every chat the agents keep for one task: the task, who works it; tapped, each agent's chat under it. */
function TaskRow({
  taskId,
  threads,
  data,
  open,
}: {
  taskId: string;
  threads: Thread[];
  data: Workspace;
  open: (thread: Thread) => void;
}) {
  const type = useType();
  const theme = useTheme();
  const s = useStyles();
  const [shown, setShown] = useState(false);
  const task = data.tasks.find((item) => item.id === taskId);
  const ids = [...new Set(threads.map((thread) => thread.agent_ids[0] ?? ""))];
  const [a, b] = ids.map((id) => agentOf(id, data.agents) ?? { id, name: id });
  const unread = threads.reduce((n, thread) => n + thread.unread, 0);
  const busy = threads.some((thread) => isWorking(thread.state));
  const waiting = threads.some((thread) => thread.state === "input-required");
  const latest = threads[0];
  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: shown }}
        onPress={() => setShown((v) => !v)}
        style={({ pressed }) => [s.row, pressed && { backgroundColor: theme.fill }]}
      >
        <View style={s.avatar}>
          {a && b ? (
            <AgentPair first={a} second={b} size={48} />
          ) : (
            <AgentAvatar name={a?.name ?? ""} blob={a?.blob} id={a?.id} size={44} />
          )}
        </View>
        <View style={s.copy}>
          <View style={s.line}>
            <Icon name="ListChecks" size={13} color={theme.fgSubtle} />
            <Text numberOfLines={1} style={[s.title, unread > 0 && { fontWeight: "600" }]}>
              {task?.title ?? latest?.title ?? taskId}
            </Text>
            {busy ? <Spinner size={12} /> : null}
            <Text style={[type.meta, unread > 0 && { color: theme.brand }, waiting && { color: theme.warning }]}>
              {busy ? t("working") : waiting ? t("waitsForYou") : listWhen(latest?.updated_at ?? "")}
            </Text>
          </View>
          <View style={s.line}>
            <Text numberOfLines={1} style={[s.preview, unread > 0 && { color: theme.fg }]}>
              {ids.map((id) => agentOf(id, data.agents)?.name ?? id).join(", ")}
            </Text>
            {unread ? <CountBadge count={unread} /> : null}
          </View>
          <Text numberOfLines={1} style={type.small}>
            {t("taskChats", { n: threads.length })}
          </Text>
        </View>
        <Icon name={shown ? "ChevronDown" : "ChevronRight"} size={16} color={theme.fgSubtle} />
      </Pressable>
      {shown ? (
        <View style={s.nested}>
          {threads.map((thread) => (
            <ChatRow key={thread.id} thread={thread} data={data} onPress={() => open(thread)} />
          ))}
        </View>
      ) : null}
    </View>
  );
}

function ChatRow({ thread, data, onPress }: { thread: Thread; data: Workspace; onPress: () => void }) {
  const type = useType();
  const theme = useTheme();
  const s = useStyles();
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
          {thread.kind === "routine" ? <Icon name="Clock" size={13} color={theme.fgSubtle} /> : null}
          <Text numberOfLines={1} style={[s.title, unread && { fontWeight: "600" }]}>
            {chatTitle(thread)}
          </Text>
          {busy ? <Spinner size={12} /> : null}
          <Text style={[type.meta, unread && { color: theme.brand }, waiting && { color: theme.warning }]}>
            {busy ? t("working") : waiting ? t("waitsForYou") : listWhen(thread.updated_at)}
          </Text>
        </View>
        <View style={s.line}>
          <Text numberOfLines={1} style={[s.preview, unread && { color: theme.fg }]}>
            {chatPreview(thread) || t("noMessagesYet")}
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

const useStyles = makeStyles((theme) => ({
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
  nested: { marginLeft: 36, borderLeftWidth: 1, borderLeftColor: theme.border },
}));
