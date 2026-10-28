import * as Notifications from "expo-notifications";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, BackHandler, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ChatScreen } from "./ChatScreen";
import { isNewChat, newChatThread } from "./chat/newChat";
import type { Creds } from "./creds";
import { inboxThreads } from "./hooks/chatSelectors";
import { inboxItems } from "./hooks/inboxItems";
import { useConnection } from "./hooks/useConnection";
import { useNotifications } from "./hooks/useNotifications";
import type { Routine, Thread } from "./hooks/useWorkspace";
import { useWorkspace } from "./hooks/useWorkspace";
import { t } from "./i18n";
import { setViewingThread } from "./notifications";
import { AboutPage } from "./pages/AboutPage";
import { ArchivedChatsPage } from "./pages/ArchivedChatsPage";
import { ChatsPage } from "./pages/ChatsPage";
import { FilesPage } from "./pages/FilesPage";
import { InboxPage } from "./pages/InboxPage";
import { MemoryPage } from "./pages/MemoryPage";
import { MoreDetailPage } from "./pages/MoreDetailPage";
import { type MoreId, MorePage } from "./pages/MorePage";
import { NewProjectPage } from "./pages/NewProjectPage";
import { NewTaskPage } from "./pages/NewTaskPage";
import { RoutineDetailPage } from "./pages/RoutineDetailPage";
import { RoutineEditPage } from "./pages/RoutineEditPage";
import { RoutinesPage } from "./pages/RoutinesPage";
import { SessionsPage } from "./pages/SessionsPage";
import { SettingsPage } from "./pages/SettingsPage";
import { TaskDetailPage } from "./pages/TaskDetailPage";
import { TasksPage } from "./pages/TasksPage";
import { SurfacesScreen } from "./SurfacesScreen";
import { ChatMenu } from "./ui/ChatMenu";
import { ChatPicker } from "./ui/ChatPicker";
import { ConnectionBanner, ConnectionEmpty } from "./ui/ConnectionState";
import { Icon } from "./ui/Icon";
import { BottomSheet, ListRow, type StackPage, StackSlide, usePageStack } from "./ui/kit";
import { BottomNav, type NavItem } from "./ui/kit/BottomNav";
import { MediaClient } from "./ui/media/context";
import { makeStyles, useTheme } from "./ui/theme";
import { useChatFilter } from "./viewPrefs";

type Tab = "chats" | "inbox" | "tasks" | "sessions" | "more";
const TABS: Array<NavItem<Tab>> = [
  { id: "chats", label: t("navChats"), icon: "MessageCircle" },
  { id: "inbox", label: t("navInbox"), icon: "Inbox" },
  { id: "tasks", label: t("navTasks"), icon: "ListChecks" },
  { id: "sessions", label: t("navSessions"), icon: "Terminal" },
  { id: "more", label: t("navMore"), icon: "LayoutGrid" },
];

/** What opens over the tabs: a chat, the apps, a routine, a task, a page of More, the archived chats. */
type Page =
  | { kind: "chat"; thread: Thread }
  | { kind: "apps" }
  | { kind: "archived" }
  | { kind: "routine" | "routineEdit"; routine: Routine }
  | { kind: "task"; id: string }
  | { kind: "newTask" }
  | { kind: "newProject" }
  | { kind: "more"; id: Exclude<MoreId, "apps"> };

export function WorkspaceScreen({
  creds,
  onUnpair,
  focus,
  onFocused,
}: {
  creds: Creds;
  onUnpair: () => void;
  /** A chat to bring up (from a scanned link); `onFocused` once it is taken. */
  focus?: string;
  onFocused?: () => void;
}) {
  const theme = useTheme();
  const s = useStyles();
  const workspace = useWorkspace(creds);
  const insets = useSafeAreaInsets();
  const host = useMemo(() => {
    try {
      const name = new URL(creds.url).hostname;
      // A machine name reads better without its network suffix (".local", a tailnet's domain); an IP stays whole.
      return /^[\d.:[\]]+$/.test(name) ? name : (name.split(".")[0] ?? name);
    } catch {
      return creds.url;
    }
  }, [creds.url]);
  const connection = useConnection(creds.url, workspace.online, workspace.loading);
  const retry = () => {
    void workspace.refresh();
    void connection.check();
  };
  const inbox = useMemo(() => inboxItems(workspace.data), [workspace.data]);
  useNotifications(creds);
  const [tab, setTab] = useState<Tab>("chats");
  /** Tabs opened once stay mounted, so each keeps its scroll and state while another is shown. */
  const [visited, setVisited] = useState<ReadonlySet<Tab>>(() => new Set(["chats"]));
  useEffect(() => setVisited((seen) => (seen.has(tab) ? seen : new Set([...seen, tab]))), [tab]);
  const stack = usePageStack<Page>();
  const [chatProject, setChatProject] = useState("all");
  const [chatFilter, setChatFilter] = useChatFilter();
  const unreadChats = useMemo(
    () => inboxThreads(workspace.data.threads, chatFilter.routines).reduce((n, thread) => n + thread.unread, 0),
    [workspace.data.threads, chatFilter.routines],
  );
  const fileActions = useMemo(
    () => ({ tree: workspace.fileTree, read: workspace.readFile, media: workspace.fileMedia }),
    [workspace.fileTree, workspace.readFile, workspace.fileMedia],
  );
  const memoryActions = useMemo(
    () => ({ list: workspace.memories, add: workspace.addMemory, remove: workspace.removeMemory }),
    [workspace.memories, workspace.addMemory, workspace.removeMemory],
  );
  const routineActions = useMemo(
    () => ({ toggle: workspace.toggleRoutine, run: workspace.runRoutine, runs: workspace.routineRuns }),
    [workspace.toggleRoutine, workspace.runRoutine, workspace.routineRuns],
  );
  const taskActions = useMemo(
    () => ({
      detail: workspace.taskDetail,
      update: workspace.updateTask,
      close: workspace.closeTask,
      remove: workspace.deleteTask,
      comment: workspace.commentTask,
    }),
    [workspace.taskDetail, workspace.updateTask, workspace.closeTask, workspace.deleteTask, workspace.commentTask],
  );
  const [picker, setPicker] = useState<"switch" | "new">();
  /** A chat's long-press sheet, or the Chats tab's ("mark all read"). */
  const [menu, setMenu] = useState<Thread | "all">();
  const [noticeThread, setNoticeThread] = useState<string>();
  const top = stack.top;
  // News about the chat on screen does not sound; the others still do.
  const viewing = top?.kind === "chat" ? top.thread.id : undefined;
  useEffect(() => {
    setViewingThread(viewing);
    return () => setViewingThread(undefined);
  }, [viewing]);
  useEffect(() => {
    const receive = (response: Notifications.NotificationResponse) => {
      const id = response.notification.request.content.data?.thread_id;
      if (typeof id === "string") setNoticeThread(id);
      Notifications.clearLastNotificationResponse();
    };
    const subscription = Notifications.addNotificationResponseReceivedListener(receive);
    void Notifications.getLastNotificationResponseAsync().then((response) => {
      if (response) receive(response);
    });
    return () => subscription.remove();
  }, []);
  const { push, back, replace, clear, gone } = stack;
  const { readThreads } = workspace;
  /** A chat opens over what is on screen; the one already on top stays as it is. */
  const showChat = useCallback(
    (thread: Thread, how: "push" | "replace" = "push") => {
      if (viewing === thread.id) return;
      (how === "replace" ? replace : push)({ kind: "chat", thread });
      if (!isNewChat(thread.id) && thread.unread > 0) void readThreads([thread.id]).catch(() => undefined);
    },
    [viewing, push, replace, readThreads],
  );
  useEffect(() => {
    const found = workspace.data.threads.find((item) => item.id === noticeThread);
    if (!found) return;
    setNoticeThread(undefined);
    showChat(found);
  }, [noticeThread, workspace.data.threads, showChat]);
  const { openThread: openOnCore } = workspace;
  useEffect(() => {
    if (!focus) return;
    onFocused?.();
    void openOnCore(focus)
      .then((result) => showChat(result.thread as Thread))
      .catch(() => undefined);
  }, [focus, onFocused, openOnCore, showChat]);
  // Android's back button climbs out of the open page before it leaves the app.
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (picker) setPicker(undefined);
      else if (back()) return true;
      else if (tab !== "chats") setTab("chats");
      else return false;
      return true;
    });
    return () => sub.remove();
  }, [picker, back, tab]);
  const openById = (id: string) => {
    const found = workspace.data.threads.find((item) => item.id === id);
    if (found) return showChat(found);
    void workspace
      .openThread(id)
      .then((result) => showChat(result.thread as Thread))
      .catch(() => undefined);
  };
  const newChat = () => setPicker("new");
  const toChats = (project: string) => {
    setChatProject(project);
    clear();
    setTab("chats");
  };
  const page = (item: StackPage<Page>) => {
    switch (item.kind) {
      case "apps":
        return <SurfacesScreen creds={creds} onBack={back} />;
      case "chat":
        return (
          <ChatScreen
            key={item.thread.id}
            creds={creds}
            onUnpair={onUnpair}
            onApps={() => push({ kind: "apps" })}
            base={item.thread}
            data={workspace.data}
            onSwitch={() => setPicker("switch")}
            onNewChat={newChat}
            make={workspace.makeChat}
            onMade={(made) => replace({ kind: "chat", thread: made })}
            onOpenThread={openById}
            onBack={back}
          />
        );
      case "archived":
        return <ArchivedChatsPage data={workspace.data} back={back} open={showChat} menu={setMenu} />;
      case "routine":
      case "routineEdit": {
        const routine = workspace.data.routines.find((r) => r.id === item.routine.id) ?? item.routine;
        return item.kind === "routineEdit" ? (
          <RoutineEditPage routine={routine} data={workspace.data} back={back} save={workspace.saveRoutine} />
        ) : (
          <RoutineDetailPage
            routine={routine}
            edit={() => push({ kind: "routineEdit", routine })}
            data={workspace.data}
            back={back}
            actions={routineActions}
            openThread={openById}
          />
        );
      }
      case "newTask":
        return (
          <NewTaskPage
            data={workspace.data}
            back={back}
            create={workspace.createTask}
            created={(created) => replace({ kind: "task", id: created.id })}
          />
        );
      case "task":
        return (
          <TaskDetailPage
            task={workspace.data.tasks.find((t) => t.id === item.id)}
            data={workspace.data}
            back={back}
            actions={taskActions}
            openThread={openById}
          />
        );
      case "newProject":
        return (
          <NewProjectPage
            host={host}
            back={back}
            create={workspace.createProject}
            created={(project) => toChats(project.id)}
          />
        );
      case "more":
        switch (item.id) {
          case "routines":
            return (
              <RoutinesPage
                data={workspace.data}
                back={back}
                open={(routine) => push({ kind: "routine", routine })}
                actions={routineActions}
              />
            );
          case "about":
            return <AboutPage data={workspace.data} url={creds.url} back={back} load={workspace.serverInfo} />;
          case "files":
            return <FilesPage data={workspace.data} back={back} actions={fileActions} />;
          case "memory":
            return <MemoryPage data={workspace.data} back={back} actions={memoryActions} />;
          case "settings":
            return (
              <SettingsPage
                creds={creds}
                data={workspace.data}
                host={host}
                back={back}
                disconnect={onUnpair}
                load={workspace.noticePrefs}
                save={workspace.setNoticePrefs}
              />
            );
          default:
            return (
              <MoreDetailPage
                id={item.id}
                data={workspace.data}
                back={back}
                openProject={toChats}
                chatWith={(agent) => showChat(newChatThread({ agent: agent.id }, t("newChat")))}
                newProject={() => push({ kind: "newProject" })}
              />
            );
        }
    }
  };
  // The tabs under an opened page re-render only when what they show changes, not each time a page opens or closes.
  const latest = useRef({ showChat, openById, newChat, push });
  latest.current = { showChat, openById, newChat, push };
  const on = useMemo(
    () => ({
      showChat: (thread: Thread) => latest.current.showChat(thread),
      openById: (id: string) => latest.current.openById(id),
      newChat: () => latest.current.newChat(),
      push: (page: Page) => latest.current.push(page),
    }),
    [],
  );
  const tabContent = (id: Tab) => {
    switch (id) {
      case "chats":
        return (
          <ChatsPage
            data={workspace.data}
            online={workspace.online}
            open={on.showChat}
            create={on.newChat}
            account={() => setTab("more")}
            refresh={workspace.refresh}
            project={chatProject}
            setProject={setChatProject}
            filter={chatFilter}
            setFilter={setChatFilter}
            menu={setMenu}
            openArchived={() => on.push({ kind: "archived" })}
          />
        );
      case "inbox":
        return (
          <InboxPage
            data={workspace.data}
            items={inbox}
            open={on.openById}
            read={workspace.readNotice}
            respond={workspace.respond}
            rerun={workspace.runRoutine}
            continueSession={workspace.continueDelegation}
          />
        );
      case "tasks":
        return (
          <TasksPage
            data={workspace.data}
            actions={taskActions}
            open={(item) => on.push({ kind: "task", id: item.id })}
            create={() => on.push({ kind: "newTask" })}
            openThread={on.openById}
          />
        );
      case "sessions":
        return (
          <SessionsPage
            data={workspace.data}
            open={on.showChat}
            create={async (engine, project) => workspace.newSession(engine, project)}
            resume={workspace.resumeSession}
          />
        );
      case "more":
        return (
          <MorePage
            data={workspace.data}
            host={host}
            online={workspace.online}
            onSelect={(id) => on.push(id === "apps" ? { kind: "apps" } : { kind: "more", id })}
          />
        );
    }
  };
  const shownTabs = TABS.filter((item) => visited.has(item.id) || item.id === tab);
  // biome-ignore lint/correctness/useExhaustiveDependencies: tabContent reads only these and the stable `on` handlers
  const tabs = useMemo(
    () => (
      <View style={s.content}>
        {shownTabs.map((item) => (
          <View key={item.id} style={[s.tab, item.id !== tab && s.hidden]}>
            {tabContent(item.id)}
          </View>
        ))}
      </View>
    ),
    [tab, visited, workspace.data, workspace.online, inbox, chatProject, chatFilter, taskActions, host, s],
  );
  if (workspace.loading && workspace.data.threads.length === 0)
    return (
      <View style={s.loading}>
        <ActivityIndicator color={theme.brand} />
        {workspace.error ? <Text style={s.error}>{workspace.error}</Text> : null}
      </View>
    );
  if (connection.offline && workspace.data.threads.length === 0)
    return <ConnectionEmpty offline={connection.offline} host={host} checking={connection.checking} retry={retry} />;
  const menuThread =
    menu && menu !== "all" ? (workspace.data.threads.find((x) => x.id === menu.id) ?? menu) : undefined;
  const unreadIds = workspace.data.threads.filter((thread) => thread.unread > 0).map((thread) => thread.id);
  return (
    <MediaClient.Provider value={workspace.client}>
      <View style={s.root}>
        {tabs}
        {connection.offline && !top ? (
          <ConnectionBanner offline={connection.offline} checking={connection.checking} retry={retry} />
        ) : null}
        <BottomNav
          items={TABS.map((item) =>
            item.id === "inbox"
              ? { ...item, badge: inbox.length }
              : item.id === "chats"
                ? { ...item, badge: unreadChats }
                : item,
          )}
          value={tab}
          onChange={setTab}
          onLongPress={(id) => id === "chats" && unreadIds.length > 0 && setMenu("all")}
        />
        {stack.pages.map((item) => (
          <StackSlide key={item.key} leaving={item.leaving} onGone={() => gone(item.key)}>
            <View style={[s.page, { paddingBottom: insets.bottom }]}>{page(item)}</View>
          </StackSlide>
        ))}
        {picker ? (
          <ChatPicker
            data={workspace.data}
            mode={picker}
            onClose={() => setPicker(undefined)}
            onOpen={(thread) => showChat(thread, top?.kind === "chat" ? "replace" : "push")}
            // Made in the core with its first message (see chat/newChat.ts).
            onCreate={async (agent, projectId) =>
              showChat(
                newChatThread({ agent: agent.id, ...(projectId ? { project: projectId } : {}) }, t("newChat")),
                top?.kind === "chat" ? "replace" : "push",
              )
            }
          />
        ) : null}
        {menuThread ? (
          <ChatMenu
            thread={menuThread}
            onClose={() => setMenu(undefined)}
            onRead={() => workspace.readThreads([menuThread.id])}
            update={(patch) => workspace.updateThread(menuThread.id, patch)}
            remove={() => workspace.deleteThread(menuThread.id)}
          />
        ) : null}
        {menu === "all" ? (
          <BottomSheet title={t("navChats")} onClose={() => setMenu(undefined)}>
            {(dismiss) => (
              <ListRow
                label={t("markAllRead")}
                sub={t("unreadChats", { n: unreadIds.length })}
                leading={<Icon name="CheckCheck" size={18} color={theme.fgMuted} />}
                chevron={false}
                onPress={() => dismiss(() => void workspace.readThreads(unreadIds).catch(() => undefined))}
              />
            )}
          </BottomSheet>
        ) : null}
      </View>
    </MediaClient.Provider>
  );
}
const useStyles = makeStyles((theme) => ({
  root: { flex: 1, backgroundColor: theme.bg },
  content: { flex: 1 },
  tab: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0 },
  hidden: { display: "none" },
  page: { flex: 1 },
  loading: { flex: 1, gap: 12, alignItems: "center", justifyContent: "center", backgroundColor: theme.bg },
  error: { color: theme.danger, paddingHorizontal: 24, textAlign: "center" },
}));
