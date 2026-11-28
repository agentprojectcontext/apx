import { useMemo, useState } from "react";
import { FlatList, Pressable, RefreshControl, ScrollView, Text, TextInput, View } from "react-native";
import { elapsed } from "../format";
import { engineName, workingNow, workSubject } from "../hooks/chatSelectors";
import { type InboxNode, inboxTree, nodeThreads, searchInbox } from "../hooks/inboxTree";
import { byAttention } from "../hooks/rowState";
import type { Agent, Job, Thread, Workspace } from "../hooks/useWorkspace";
import { t } from "../i18n";
import { ChatFilterSheet } from "../ui/ChatFilterSheet";
import { Icon } from "../ui/Icon";
import { BottomSheet, Dot, EmptyState, IconButton, ListRow, OwnerAvatar, Segmented, Spinner, useType } from "../ui/kit";
import { makeStyles, useTheme } from "../ui/theme";
import { type ChatFilter, filtering } from "../viewPrefs";
import { InboxRow, inboxTitle, ThreadAvatar } from "./InboxRows";
import { SessionsPage } from "./SessionsPage";

/** As the panel's Inbox: chats, task chats and routine runs in a tab each, and the engines' sessions. */
type Tab = "chats" | "tasks" | "routines" | "sessions";
type ListTab = Exclude<Tab, "sessions">;
const TAB_OF = { thread: "chats", channel: "chats", task: "tasks", routine: "routines" } as const;
// A run from before routines had ids is still a routine's.
const tabOf = (node: InboxNode): ListTab => (node.thread.kind === "routine" ? "routines" : TAB_OF[node.kind]);
const TAB_TITLE = { chats: "navChats", tasks: "navTasks", routines: "routines" } as const;
const SEARCH = { chats: "searchChats", tasks: "searchTasks", routines: "searchRoutines" } as const;

export function ChatsPage({
  data,
  online,
  open,
  create,
  account,
  refresh,
  filter,
  setFilter,
  menu,
  taskMenu,
  openArchived,
  readThreads,
  sessions,
}: {
  data: Workspace;
  online: boolean;
  open: (thread: Thread) => void;
  create: () => void;
  account: () => void;
  refresh: () => Promise<void>;
  /** Whose chats are listed (channels, agents, projects); the filter button changes it. */
  filter: ChatFilter;
  setFilter: (next: ChatFilter) => void;
  /** A long press on a chat: its own actions. */
  menu?: (thread: Thread) => void;
  /** A long press on a task's row: the task's options, with every chat it holds. */
  taskMenu?: (taskId: string, threads: Thread[]) => void;
  /** Opens the archived chats of every tab; offered from a long press on Chats. */
  openArchived?: () => void;
  /** Marks chats read; a long press on a tab offers it for that tab's chats. */
  readThreads?: (ids: string[]) => Promise<void>;
  /** Starting and resuming the engines' sessions, in their own tab (left out: no Sessions tab). */
  sessions?: {
    create: (engine: string, project: string) => Promise<Thread>;
    resume: (engine: string, id: string) => Promise<Thread>;
  };
}) {
  const type = useType();
  const theme = useTheme();
  const s = useStyles();
  const [query, setQuery] = useState<string>();
  const [refreshing, setRefreshing] = useState(false);
  const [filters, setFilters] = useState(false);
  const working = useMemo(() => workingNow(data.threads, data.jobs.running), [data.threads, data.jobs.running]);
  const [tab, setTab] = useState<Tab>("chats");
  // Search and filters belong to the lists; Sessions keeps the last list's.
  const [listTab, setListTab] = useState<ListTab>("chats");
  const pick = (next: Tab) => {
    setTab(next);
    if (next !== "sessions") setListTab(next);
  };
  const onSessions = tab === "sessions";
  /** The tab whose options a long press opened. */
  const [held, setHeld] = useState<ListTab>();
  const tree = useMemo(
    () => inboxTree(data.threads, { ...filter, routines: true, tasks: true }, data.tasks),
    [data.threads, data.tasks, filter],
  );
  const rows = useMemo(() => {
    const shown = tree.filter((node) => tabOf(node) === listTab);
    // Tasks go by what needs the owner: waiting and running on top, dropped and done at the end.
    return searchInbox(listTab === "tasks" ? byAttention(shown, data.tasks) : shown, query, (node) =>
      inboxTitle(node, data),
    );
  }, [tree, listTab, query, data]);
  const unreadIn = (which: ListTab) =>
    tree
      .filter((node) => tabOf(node) === which)
      .flatMap(nodeThreads)
      .filter((thread) => thread.unread > 0)
      .map((thread) => thread.id);
  const heldUnread = held ? unreadIn(held) : [];
  const searching = !!query?.trim();
  const archived = useMemo(
    () => inboxTree(data.threads, { routines: true, archived: true }, data.tasks).flatMap(nodeThreads).length,
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
  const filtered = filtering(filter);
  return (
    <View style={s.root}>
      {/* Title, search and filters stay put; only the list under them scrolls. */}
      <View style={s.header}>
        <Text accessibilityRole="header" style={s.title}>
          {t("navChats")}
        </Text>
        <IconButton icon="SquarePen" label={t("newChat")} size={18} color={theme.fgMuted} onPress={create} />
        {onSessions ? null : (
          <>
            <IconButton
              icon="Search"
              label={t(SEARCH[listTab])}
              size={18}
              color={query === undefined ? theme.fgMuted : theme.fg}
              onPress={() => setQuery((q) => (q === undefined ? "" : undefined))}
            />
            <View>
              <IconButton
                icon="ListFilter"
                label={t(filtered ? "filterChatsOn" : "filterChats")}
                size={18}
                color={filtered ? theme.fg : theme.fgMuted}
                onPress={() => setFilters(true)}
              />
              {filtered ? <Dot size={7} style={s.filterDot} /> : null}
            </View>
          </>
        )}
        <Pressable accessibilityRole="button" accessibilityLabel={t("navMore")} onPress={account} style={s.account}>
          <OwnerAvatar name={data.owner} online={online} size={28} />
        </Pressable>
      </View>
      {/* Searching takes the tabs' place: the list under it stays where it was. */}
      <View style={s.switch}>
        {query !== undefined && !onSessions ? (
          <View style={s.search}>
            <Icon name="Search" size={15} color={theme.fgSubtle} />
            <TextInput
              autoFocus
              value={query}
              onChangeText={setQuery}
              accessibilityLabel={t(SEARCH[listTab])}
              placeholder={t(SEARCH[listTab])}
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
          <Segmented
            value={tab}
            onChange={pick}
            onLongPress={(which) => {
              pick(which);
              if (which !== "sessions") setHeld(which);
            }}
            style={s.tabs}
            options={[
              { value: "chats", label: t("navChats") },
              { value: "tasks", label: t("navTasks") },
              { value: "routines", label: t("routines") },
              ...(sessions ? [{ value: "sessions" as const, label: t("navSessions") }] : []),
            ]}
          />
        )}
      </View>
      {onSessions && sessions ? (
        <SessionsPage data={data} open={open} create={sessions.create} resume={sessions.resume} embedded />
      ) : null}
      <FlatList
        style={onSessions ? s.hidden : undefined}
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
        contentContainerStyle={{ paddingBottom: 24 }}
        ListEmptyComponent={
          filtered || searching ? (
            <EmptyState title={t("filterNone")} icon="ListFilter" />
          ) : listTab === "tasks" ? (
            <EmptyState title={t("emptyTaskChats")} icon="ListChecks" />
          ) : listTab === "routines" ? (
            <EmptyState title={t("emptyRoutineChats")} icon="Clock" />
          ) : (
            <EmptyState title={t("noChats")} body={t("noChatsBody")} icon="MessageCircle" />
          )
        }
        ListHeaderComponent={
          working.length > 0 ? (
            <>
              <Text style={[type.meta, s.workingLabel]}>{t("workingNow", { n: working.length })}</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.strip}>
                {working.map(({ thread, job }) => (
                  <WorkChip key={thread.id} thread={thread} job={job} data={data} onPress={() => open(thread)} />
                ))}
              </ScrollView>
            </>
          ) : null
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
      {held ? (
        <BottomSheet title={t(TAB_TITLE[held])} onClose={() => setHeld(undefined)}>
          {(dismiss) => [
            <ListRow
              key="read"
              label={t("markAllRead")}
              sub={heldUnread.length ? t("unreadChats", { n: heldUnread.length }) : t("allRead")}
              leading={<Icon name="CheckCheck" size={18} color={theme.fgMuted} />}
              chevron={false}
              {...(heldUnread.length && readThreads
                ? { onPress: () => dismiss(() => void readThreads(heldUnread).catch(() => undefined)) }
                : {})}
            />,
            held === "chats" && openArchived ? (
              <ListRow
                key="archived"
                label={t("seeArchived")}
                sub={archived ? t("archivedCount", { n: archived }) : t("noArchivedChats")}
                leading={<Icon name="Archive" size={18} color={theme.fgMuted} />}
                onPress={() => dismiss(openArchived)}
              />
            ) : null,
          ]}
        </BottomSheet>
      ) : null}
      {filters ? (
        <ChatFilterSheet
          filter={filter}
          agents={listedAgents}
          projects={projects}
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
  // An engine session is the engine at work, not the agent that opened it.
  const who = thread.engine
    ? engineName(thread.engine)
    : (agentOf(job?.agent_id ?? thread.agent_ids[0], agents)?.name ?? thread.title);
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
  // The tabs and the search share one row of the same height.
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
  tabs: { marginHorizontal: 16 },
  hidden: { display: "none" },
  filterDot: { position: "absolute", top: 11, right: 11, backgroundColor: theme.brand },
}));
