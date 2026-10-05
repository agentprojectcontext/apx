import { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { ChatScreen } from "./ChatScreen";
import type { Creds } from "./creds";
import type { Thread } from "./hooks/useWorkspace";
import { useWorkspace } from "./hooks/useWorkspace";
import { ChatsPage } from "./pages/ChatsPage";
import { InboxPage } from "./pages/InboxPage";
import { MoreDetailPage, MorePage } from "./pages/MorePage";
import { RoutinesPage } from "./pages/RoutinesPage";
import { SessionsPage } from "./pages/SessionsPage";
import { TasksPage } from "./pages/TasksPage";
import { SurfacesScreen } from "./SurfacesScreen";
import { ChatPicker } from "./ui/ChatPicker";
import { Icon, type IconName } from "./ui/Icon";
import { theme as t } from "./ui/theme";

type Tab = "chats" | "inbox" | "tasks" | "sessions" | "more";
const TABS: Array<{ id: Tab; label: string; icon: IconName }> = [
  { id: "chats", label: "Chats", icon: "MessageCircle" },
  { id: "inbox", label: "Bandeja", icon: "Inbox" },
  { id: "tasks", label: "Tareas", icon: "ListChecks" },
  { id: "sessions", label: "Sesiones", icon: "Terminal" },
  { id: "more", label: "Más", icon: "LayoutGrid" },
];

export function WorkspaceScreen({ creds, onUnpair }: { creds: Creds; onUnpair: () => void }) {
  const workspace = useWorkspace(creds);
  const [tab, setTab] = useState<Tab>("chats");
  const [thread, setThread] = useState<Thread>();
  const [subpage, setSubpage] = useState<string>();
  const [surfaces, setSurfaces] = useState(false);
  const [picker, setPicker] = useState<"switch" | "new">();
  const openThread = async (item: Thread) => {
    setThread(item);
    void workspace.openThread(item.id).catch(() => undefined);
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
          threadId={thread.id}
          title={thread.title}
          blob={workspace.data.agents.find((agent) => agent.id === thread.agent_ids[0])?.blob}
          agentId={thread.agent_ids[0]}
          agents={workspace.data.agents}
          onSwitch={() => setPicker("switch")}
          onBack={() => setThread(undefined)}
        />
      );
    if (subpage === "routines")
      return (
        <RoutinesPage
          data={workspace.data}
          back={() => setSubpage(undefined)}
          toggle={workspace.toggleRoutine}
          run={workspace.runRoutine}
        />
      );
    if (subpage) return <MoreDetailPage id={subpage} data={workspace.data} back={() => setSubpage(undefined)} />;
    switch (tab) {
      case "chats":
        return <ChatsPage data={workspace.data} open={openThread} create={newChat} />;
      case "inbox":
        return (
          <InboxPage data={workspace.data} open={openThread} read={workspace.readNotice} respond={workspace.respond} />
        );
      case "tasks":
        return (
          <TasksPage
            data={workspace.data}
            open={(id) => {
              const item = workspace.data.threads.find((row) => row.id === id);
              if (item) void openThread(item);
            }}
          />
        );
      case "sessions":
        return <SessionsPage data={workspace.data} open={openThread} create={workspace.createSession} />;
      case "more":
        return <MorePage data={workspace.data} onSelect={setSubpage} />;
    }
  };
  if (workspace.loading && workspace.data.threads.length === 0)
    return (
      <View style={s.loading}>
        <ActivityIndicator color={t.brand} />
        {workspace.error ? <Text style={s.error}>{workspace.error}</Text> : null}
      </View>
    );
  return (
    <View style={s.root}>
      <View style={s.content}>{content()}</View>
      {!thread && !surfaces ? (
        <View style={s.tabs}>
          {TABS.map((item) => (
            <Pressable
              key={item.id}
              accessibilityRole="tab"
              accessibilityState={{ selected: tab === item.id }}
              onPress={() => {
                setTab(item.id);
                setSubpage(undefined);
              }}
              style={s.tab}
            >
              <View style={[s.tabIconWrap, tab === item.id && s.activeIconWrap]}>
                <Icon name={item.icon} size={21} color={tab === item.id ? t.fg : t.muted} />
                {item.id === "inbox" && workspace.data.unread > 0 ? (
                  <View style={s.badge}>
                    <Text style={s.badgeText}>{workspace.data.unread > 9 ? "9+" : workspace.data.unread}</Text>
                  </View>
                ) : null}
              </View>
              <Text style={[s.tabLabel, tab === item.id && s.activeTab]}>{item.label}</Text>
            </Pressable>
          ))}
        </View>
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
  root: { flex: 1, backgroundColor: t.bg },
  content: { flex: 1 },
  loading: { flex: 1, gap: 12, alignItems: "center", justifyContent: "center", backgroundColor: t.bg },
  error: { color: t.danger, paddingHorizontal: 24, textAlign: "center" },
  tabs: {
    height: 68,
    flexDirection: "row",
    paddingTop: 5,
    paddingBottom: 2,
    backgroundColor: t.sidebar,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: t.border,
  },
  tab: { flex: 1, alignItems: "center", justifyContent: "center", gap: 2 },
  tabIconWrap: {
    width: 60,
    height: 32,
    borderRadius: 999,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  activeIconWrap: { backgroundColor: t.fillHover },
  tabIcon: { color: t.muted, fontSize: 19, fontWeight: "500" },
  tabLabel: { color: t.muted, fontSize: 11 },
  activeTab: { color: t.fg, fontWeight: "600" },
  badge: {
    position: "absolute",
    top: -1,
    right: 10,
    minWidth: 15,
    height: 15,
    borderRadius: 9,
    paddingHorizontal: 3,
    backgroundColor: t.danger,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: { color: "white", fontSize: 9, fontWeight: "700" },
});
