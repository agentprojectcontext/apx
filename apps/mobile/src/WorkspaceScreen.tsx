import * as Notifications from "expo-notifications";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ChatScreen } from "./ChatScreen";
import type { Creds } from "./creds";
import { inboxItems } from "./hooks/inboxItems";
import { useNotifications } from "./hooks/useNotifications";
import type { Routine, Thread } from "./hooks/useWorkspace";
import { useWorkspace } from "./hooks/useWorkspace";
import { t } from "./i18n";
import { ChatsPage } from "./pages/ChatsPage";
import { InboxPage } from "./pages/InboxPage";
import { MemoryPage } from "./pages/MemoryPage";
import { MoreDetailPage } from "./pages/MoreDetailPage";
import { type MoreId, MorePage } from "./pages/MorePage";
import { RoutineDetailPage } from "./pages/RoutineDetailPage";
import { RoutinesPage } from "./pages/RoutinesPage";
import { SessionsPage } from "./pages/SessionsPage";
import { SettingsPage } from "./pages/SettingsPage";
import { TasksPage } from "./pages/TasksPage";
import { SurfacesScreen } from "./SurfacesScreen";
import { ChatPicker } from "./ui/ChatPicker";
import { BottomNav, type NavItem } from "./ui/kit/BottomNav";
import { theme } from "./ui/theme";

type Tab = "chats" | "inbox" | "tasks" | "sessions" | "more";
const TABS: Array<NavItem<Tab>> = [
  { id: "chats", label: t("navChats"), icon: "MessageCircle" },
  { id: "inbox", label: t("navInbox"), icon: "Inbox" },
  { id: "tasks", label: t("navTasks"), icon: "ListChecks" },
  { id: "sessions", label: t("navSessions"), icon: "Terminal" },
  { id: "more", label: t("navMore"), icon: "LayoutGrid" },
];

export function WorkspaceScreen({ creds, onUnpair }: { creds: Creds; onUnpair: () => void }) {
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
  const inbox = useMemo(() => inboxItems(workspace.data), [workspace.data]);
  useNotifications(creds);
  const [tab, setTab] = useState<Tab>("chats");
  const [thread, setThread] = useState<Thread>();
  const [subpage, setSubpage] = useState<MoreId>();
  const [routine, setRoutine] = useState<Routine>();
  const memoryActions = useMemo(
    () => ({ list: workspace.memories, add: workspace.addMemory, remove: workspace.removeMemory }),
    [workspace.memories, workspace.addMemory, workspace.removeMemory],
  );
  const routineActions = useMemo(
    () => ({ toggle: workspace.toggleRoutine, run: workspace.runRoutine, runs: workspace.routineRuns }),
    [workspace.toggleRoutine, workspace.runRoutine, workspace.routineRuns],
  );
  const [surfaces, setSurfaces] = useState(false);
  const [picker, setPicker] = useState<"switch" | "new">();
  const [noticeThread, setNoticeThread] = useState<string>();
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
  useEffect(() => {
    const found = workspace.data.threads.find((item) => item.id === noticeThread);
    if (!found) return;
    setThread(found);
    setNoticeThread(undefined);
    setSubpage(undefined);
    setSurfaces(false);
  }, [noticeThread, workspace.data.threads]);
  const openThread = async (item: Thread) => {
    setThread(item);
    void workspace.openThread(item.id).catch(() => undefined);
  };
  const openById = (id: string) => {
    const found = workspace.data.threads.find((item) => item.id === id);
    if (found) return void openThread(found);
    void workspace
      .openThread(id)
      .then((result) => setThread(result.thread as Thread))
      .catch(() => undefined);
  };
  const newChat = () => setPicker("new");
  const content = () => {
    if (surfaces) return <SurfacesScreen creds={creds} onBack={() => setSurfaces(false)} />;
    if (thread)
      return (
        <ChatScreen
          key={thread.id}
          creds={creds}
          onUnpair={onUnpair}
          onApps={() => setSurfaces(true)}
          base={thread}
          data={workspace.data}
          onSwitch={() => setPicker("switch")}
          onNewChat={newChat}
          onBack={() => setThread(undefined)}
        />
      );
    if (routine)
      return (
        <RoutineDetailPage
          routine={workspace.data.routines.find((item) => item.id === routine.id) ?? routine}
          data={workspace.data}
          back={() => setRoutine(undefined)}
          actions={routineActions}
          openThread={openById}
        />
      );
    if (subpage === "routines")
      return (
        <RoutinesPage
          data={workspace.data}
          back={() => setSubpage(undefined)}
          open={setRoutine}
          actions={routineActions}
        />
      );
    if (subpage === "memory")
      return <MemoryPage data={workspace.data} back={() => setSubpage(undefined)} actions={memoryActions} />;
    if (subpage === "settings")
      return (
        <SettingsPage
          creds={creds}
          data={workspace.data}
          host={host}
          back={() => setSubpage(undefined)}
          disconnect={onUnpair}
          load={workspace.noticePrefs}
          save={workspace.setNoticePrefs}
        />
      );
    if (subpage && subpage !== "apps")
      return (
        <MoreDetailPage
          id={subpage}
          data={workspace.data}
          back={() => setSubpage(undefined)}
          chatWith={(agent) =>
            void workspace
              .createChat(agent.id)
              .then(setThread)
              .catch(() => undefined)
          }
        />
      );
    switch (tab) {
      case "chats":
        return (
          <ChatsPage
            data={workspace.data}
            online={workspace.online}
            open={openThread}
            create={newChat}
            account={() => setTab("more")}
            refresh={workspace.refresh}
          />
        );
      case "inbox":
        return (
          <InboxPage
            data={workspace.data}
            items={inbox}
            open={openById}
            read={workspace.readNotice}
            respond={workspace.respond}
            rerun={workspace.runRoutine}
          />
        );
      case "tasks":
        return <TasksPage data={workspace.data} open={openById} />;
      case "sessions":
        return (
          <SessionsPage
            data={workspace.data}
            open={openThread}
            create={workspace.createSession}
            resume={workspace.resumeSession}
          />
        );
      case "more":
        return (
          <MorePage
            data={workspace.data}
            host={host}
            online={workspace.online}
            onSelect={(id) => (id === "apps" ? setSurfaces(true) : setSubpage(id))}
          />
        );
    }
  };
  if (workspace.loading && workspace.data.threads.length === 0)
    return (
      <View style={s.loading}>
        <ActivityIndicator color={theme.brand} />
        {workspace.error ? <Text style={s.error}>{workspace.error}</Text> : null}
      </View>
    );
  return (
    <View style={s.root}>
      <View style={[s.content, (thread || surfaces) && { paddingBottom: insets.bottom }]}>{content()}</View>
      {!thread && !surfaces ? (
        <BottomNav
          items={TABS.map((item) => (item.id === "inbox" ? { ...item, badge: inbox.length } : item))}
          value={tab}
          onChange={(id) => {
            setTab(id);
            setSubpage(undefined);
            setRoutine(undefined);
          }}
        />
      ) : null}
      {picker ? (
        <ChatPicker
          data={workspace.data}
          mode={picker}
          onClose={() => setPicker(undefined)}
          onOpen={openThread}
          onCreate={async (agent, projectId) => {
            const created = await workspace.createChat(agent.id, projectId);
            setThread(created);
          }}
        />
      ) : null}
    </View>
  );
}
const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg },
  content: { flex: 1 },
  loading: { flex: 1, gap: 12, alignItems: "center", justifyContent: "center", backgroundColor: theme.bg },
  error: { color: theme.danger, paddingHorizontal: 24, textAlign: "center" },
});
