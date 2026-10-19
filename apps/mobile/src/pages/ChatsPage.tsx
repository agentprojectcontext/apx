import { useMemo, useState } from "react";
import { Pressable, RefreshControl, ScrollView, Text, TextInput, View } from "react-native";
import { elapsed } from "../format";
import { workingNow, workSubject } from "../hooks/chatSelectors";
import { inboxTree, searchInbox } from "../hooks/inboxTree";
import type { Agent, Job, Thread, Workspace } from "../hooks/useWorkspace";
import { t } from "../i18n";
import { Icon } from "../ui/Icon";
import { Chip, EmptyState, Fab, IconButton, OwnerAvatar, Spinner, useType } from "../ui/kit";
import { makeStyles, useTheme } from "../ui/theme";
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
  const rows = searchInbox(inboxTree(data.threads, { routines, project }), query, (node) => inboxTitle(node, data));
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
            accessibilityLabel={t("searchChats")}
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
        testID="chats-list"
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
              void refresh()
                .catch(() => undefined)
                .finally(() => setRefreshing(false));
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
          rows.map((node) => (
            <InboxRow key={node.key} node={node} data={data} open={open} searching={!!query?.trim()} />
          ))
        ) : (
          <EmptyState title={t("noChats")} body={t("noChatsBody")} icon="MessageCircle" />
        )}
      </ScrollView>
      <Fab icon="SquarePen" label={t("newChat")} onPress={create} />
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
}));
