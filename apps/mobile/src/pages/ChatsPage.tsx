import { useMemo, useState } from "react";
import { FlatList, Pressable, RefreshControl, ScrollView, Text, TextInput, View } from "react-native";
import { elapsed } from "../format";
import { workingNow, workSubject } from "../hooks/chatSelectors";
import { inboxTree, nodeThreads, searchInbox } from "../hooks/inboxTree";
import type { Agent, Job, Thread, Workspace } from "../hooks/useWorkspace";
import { t } from "../i18n";
import { ChatFilterSheet } from "../ui/ChatFilterSheet";
import { Icon } from "../ui/Icon";
import { Chip, Dot, EmptyState, Fab, IconButton, OwnerAvatar, Spinner, useType } from "../ui/kit";
import { makeStyles, useTheme } from "../ui/theme";
import { type ChatFilter, filtering } from "../viewPrefs";
import { InboxRow, inboxTitle, ThreadAvatar } from "./InboxRows";

export function ChatsPage({
  data,
  online,
  open,
  create,
  account,
  refresh,
  project,
  setProject,
  filter,
  setFilter,
  menu,
  taskMenu,
  openArchived,
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
  /** What is listed besides the chats (routine news, task chats) and whose chats; the filter button changes it. */
  filter: ChatFilter;
  setFilter: (next: ChatFilter) => void;
  /** A long press on a chat: its own actions. */
  menu?: (thread: Thread) => void;
  /** A long press on a task's row: the task's options. */
  taskMenu?: (taskId: string) => void;
  /** Opens the archived chats; offered while there are some. */
  openArchived?: () => void;
}) {
  const type = useType();
  const theme = useTheme();
  const s = useStyles();
  const [query, setQuery] = useState<string>();
  const [refreshing, setRefreshing] = useState(false);
  const [filters, setFilters] = useState(false);
  const working = useMemo(() => workingNow(data.threads, data.jobs.running), [data.threads, data.jobs.running]);
  const tree = useMemo(
    () => inboxTree(data.threads, { ...filter, project }, data.tasks),
    [data.threads, data.tasks, filter, project],
  );
  const rows = useMemo(() => searchInbox(tree, query, (node) => inboxTitle(node, data)), [tree, query, data]);
  const searching = !!query?.trim();
  const archived = useMemo(
    () =>
      inboxTree(data.threads, { routines: true, project: "all", archived: true }, data.tasks).flatMap(nodeThreads)
        .length,
    [data.threads, data.tasks],
  );
  const listedAgents = useMemo(
    () =>
      data.agents.filter(
        (agent) =>
          filter.agents.includes(agent.id) ||
          data.threads.some((thread) => !thread.archived && thread.agent_ids.includes(agent.id)),
      ),
    [data.agents, data.threads, filter.agents],
  );
  const projects = data.projects.filter((item) => item.registered !== false);
  return (
    <View style={s.root}>
      {/* Title, search and filters stay put; only the list under them scrolls. */}
      <View style={s.header}>
        <Text accessibilityRole="header" style={s.title}>
          {t("navChats")}
        </Text>
        <View>
          <IconButton
            icon="ListFilter"
            label={t(filtering(filter) ? "filterChatsOn" : "filterChats")}
            size={18}
            color={filtering(filter) ? theme.fg : theme.fgMuted}
            onPress={() => setFilters(true)}
          />
          {filtering(filter) ? <Dot size={7} style={s.filterDot} /> : null}
        </View>
        <IconButton
          icon="Search"
          label={t("searchChats")}
          size={18}
          color={query === undefined ? theme.fgMuted : theme.fg}
          onPress={() => setQuery((q) => (q === undefined ? "" : undefined))}
        />
        <Pressable accessibilityRole="button" accessibilityLabel={t("navMore")} onPress={account} style={s.account}>
          <OwnerAvatar name={data.owner} online={online} size={28} />
        </Pressable>
      </View>
      {/* Searching takes the projects' place: the list under it stays where it was. */}
      <View style={s.switch}>
        {query !== undefined ? (
          <View style={s.search}>
            <Icon name="Search" size={15} color={theme.fgSubtle} />
            <TextInput
              autoFocus
              value={query}
              onChangeText={setQuery}
              accessibilityLabel={t("searchChats")}
              placeholder={t("searchChats")}
              placeholderTextColor={theme.fgSubtle}
              returnKeyType="search"
              style={s.searchInput}
            />
            <IconButton
              icon="X"
              label={t("closeSearch")}
              size={15}
              color={theme.fgMuted}
              style={s.searchClose}
              onPress={() => setQuery(undefined)}
            />
          </View>
        ) : (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chips}>
            <Chip label={t("all")} selected={project === "all"} onPress={() => setProject("all")} />
            <Chip label={t("defaultProject")} selected={project === "default"} onPress={() => setProject("default")} />
            {projects.map((item) => (
              <Chip
                key={item.id}
                label={item.name}
                selected={project === item.id}
                onPress={() => setProject(item.id)}
              />
            ))}
          </ScrollView>
        )}
      </View>
      <FlatList
        testID="chats-list"
        data={rows}
        keyExtractor={(node) => node.key}
        renderItem={({ item }) => (
          <InboxRow
            node={item}
            data={data}
            open={open}
            {...(menu ? { menu } : {})}
            {...(taskMenu ? { taskMenu } : {})}
            searching={searching}
          />
        )}
        initialNumToRender={14}
        windowSize={7}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: 96 }}
        ListEmptyComponent={<EmptyState title={t("noChats")} body={t("noChatsBody")} icon="MessageCircle" />}
        ListHeaderComponent={
          <>
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
            {archived > 0 && openArchived && !searching ? (
              <Pressable
                accessibilityRole="button"
                onPress={openArchived}
                style={({ pressed }) => [s.archived, pressed && { backgroundColor: theme.fill }]}
              >
                <View style={s.archivedIcon}>
                  <Icon name="Archive" size={18} color={theme.fgMuted} />
                </View>
                <Text style={s.archivedLabel}>{t("archivedChats")}</Text>
                <Text style={type.meta}>{archived}</Text>
              </Pressable>
            ) : null}
          </>
        }
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            tintColor={theme.fgMuted}
            colors={[theme.fg]}
            progressBackgroundColor={theme.surfaceRaised}
            onRefresh={() => {
              setRefreshing(true);
              void refresh()
                .catch(() => undefined)
                .finally(() => setRefreshing(false));
            }}
          />
        }
      />
      <Fab icon="SquarePen" label={t("newChat")} onPress={create} />
      {filters ? (
        <ChatFilterSheet
          filter={filter}
          agents={listedAgents}
          channels={data.channels}
          threads={data.threads}
          onChange={setFilter}
          onClose={() => setFilters(false)}
        />
      ) : null}
    </View>
  );
}

const agentOf = (id: string | undefined, agents: Agent[]) => agents.find((agent) => agent.id === id);

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
      <ThreadAvatar
        thread={thread}
        agents={agents}
        data={data}
        size={32}
        caller={data.threads.find((parent) => parent.id === thread.parent_id)?.agent_ids[0]}
      />
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

const useStyles = makeStyles((theme) => ({
  root: { flex: 1, backgroundColor: theme.bg },
  header: { height: 52, flexDirection: "row", alignItems: "center", gap: 2, paddingLeft: 16, paddingRight: 8 },
  title: { flex: 1, color: theme.fg, fontSize: 22, fontWeight: "600" },
  account: { width: 40, height: 44, alignItems: "center", justifyContent: "center" },
  // The projects and the search share one row of the same height.
  switch: { height: 44, justifyContent: "center" },
  search: {
    height: 36,
    marginHorizontal: 16,
    paddingLeft: 12,
    borderRadius: 999,
    backgroundColor: theme.fill,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  searchInput: { flex: 1, color: theme.fg, fontSize: 15, paddingVertical: 0 },
  searchClose: { width: 36, height: 36 },
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
  chips: { gap: 8, paddingHorizontal: 16, alignItems: "center" },
  filterDot: { position: "absolute", top: 11, right: 11, backgroundColor: theme.brand },
  archived: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8, paddingHorizontal: 16 },
  archivedIcon: { width: 30, height: 30, alignItems: "center", justifyContent: "center" },
  archivedLabel: { flex: 1, color: theme.fg, fontSize: 15, fontWeight: "500" },
}));
