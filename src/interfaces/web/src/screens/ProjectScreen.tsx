import { useMemo } from "react";
import { useNavigate, useParams, Routes, Route, useLocation } from "react-router-dom";
import {
  Bot, Heart, Zap, Puzzle, FolderKanban, Settings,
  RefreshCw, MessagesSquare, Send,
  LayoutDashboard, Boxes, Cpu, ScrollText, History, Brain,
} from "lucide-react";
import { Projects } from "../lib/api";
import { Button } from "../components/ui";
import { useToast } from "../components/Toast";
import { useNavCollapse, type TabSection } from "../components/common/TabNav";
import { TabLayout } from "../components/common/TabLayout";
import { useProject } from "../hooks/useProjects";
import { STORAGE } from "../constants";
import { t } from "../i18n";
import { Overview } from "./project/Overview";
import { WorkspacesTab } from "./base/WorkspacesTab";
import { LogsTab } from "./base/LogsTab";
import { ModelsTab } from "./base/ModelsTab";
import { AgentDefaultsTab } from "./base/AgentDefaultsTab";
import { SessionsTab } from "./base/SessionsTab";
import { GlobalTasksTab } from "./base/GlobalTasksTab";
import { ConfigTab } from "./project/ConfigTab";
import { AgentsTab } from "./project/AgentsTab";
import { RoutinesTab } from "./project/RoutinesTab";
import { TasksTab } from "./project/TasksTab";
import { McpsTab } from "./project/McpsTab";
import { ThreadsTab } from "./project/ThreadsTab";
import { ChatTab } from "./project/ChatTab";
import { TelegramTab } from "./project/TelegramTab";
import { MemoriesTab } from "./project/MemoriesTab";
import { AgentDetailScreen } from "./project/AgentDetailScreen";

type NavKey =
  | "" | "chat" | "config" | "telegram"
  | "agents" | "routines" | "tasks" | "mcps" | "threads" | "logs" | "memories";

export function ProjectScreen() {
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const { pid = "" } = useParams();
  const { project, mutate } = useProject(pid);
  const { collapsed, toggle } = useNavCollapse(STORAGE.sidebarCollapsed + ".project");

  const isBase = String(pid) === "0";
  const sections: TabSection[] = useMemo(() => {
    if (isBase) {
      // Base = menú global / admin del daemon (distinto al de un proyecto).
      return [
        {
          title: t("base.nav_general"),
          items: [
            { key: "",               label: "Dashboard",                    icon: LayoutDashboard },
            { key: "workspaces",     label: t("base.workspaces_title"),     icon: Boxes },
            { key: "models",         label: t("settings.tabs.engines"),     icon: Cpu },
            { key: "agent-defaults", label: t("base.defaults_title"),       icon: Bot },
          ],
        },
        {
          title: t("base.nav_activity"),
          items: [
            { key: "chat",     label: t("project.nav.chat"),     icon: MessagesSquare },
            { key: "sessions", label: t("base.sessions_title"),  icon: History },
            { key: "tasks",    label: t("project.nav.tasks"),    icon: Zap },
            { key: "logs",     label: t("project.nav.logs"),     icon: ScrollText },
          ],
        },
        {
          title: t("base.nav_system"),
          items: [
            { key: "agents",   label: t("project.nav.agents"),   icon: Bot },
            { key: "memories", label: t("project.nav.memories"), icon: Brain },
            { key: "routines", label: t("project.nav.routines"), icon: Heart },
            { key: "mcps",     label: t("project.nav.mcps"),     icon: Puzzle },
            { key: "config",   label: t("project.nav.config"),   icon: Settings },
          ],
        },
      ];
    }
    return [
      {
        title: t("project.sections.workspace"),
        items: [
          { key: "",         label: t("project.nav.overview"),  icon: FolderKanban },
          { key: "telegram", label: t("project.nav.telegram"),  icon: Send },
          { key: "chat",     label: t("project.nav.chat"),      icon: MessagesSquare },
          { key: "threads",  label: t("project.nav.threads"),   icon: MessagesSquare },
          { key: "agents",   label: t("project.nav.agents"),    icon: Bot },
          { key: "memories", label: t("project.nav.memories"),  icon: Brain },
        ],
      },
      {
        title: t("project.sections.automation"),
        items: [
          { key: "routines", label: t("project.nav.routines"),  icon: Heart },
          { key: "tasks",    label: t("project.nav.tasks"),     icon: Zap },
          { key: "mcps",     label: t("project.nav.mcps"),      icon: Puzzle },
          { key: "logs",     label: t("project.nav.logs"),      icon: ScrollText },
        ],
      },
      {
        title: t("project.sections.config"),
        items: [
          { key: "config",   label: t("project.nav.config"),    icon: Settings },
        ],
      },
    ];
  }, [isBase]);

  // First path segment after /p/:pid — so deep routes like agents/:slug still
  // highlight the "agents" nav item.
  const active = (location.pathname.replace(`/p/${pid}`, "").replace(/^\//, "").split("/")[0]) as NavKey;

  if (!project) {
    return <div className="p-8 text-muted-fg">{t("project.not_found", { pid })}</div>;
  }

  const rebuild = async () => {
    try { await Projects.rebuild(pid); toast.success(t("project.rebuild_done")); }
    catch (e) { toast.error((e as Error).message); }
  };
  const unregister = async () => {
    const label = project.name || project.path;
    if (!confirm(t("project.unregister_confirm", { label }))) return;
    try { await Projects.remove(pid); toast.success(t("project.unregistered")); mutate(); navigate("/"); }
    catch (e) { toast.error((e as Error).message); }
  };

  const onTabChange = (key: string) => {
    const url = key ? `/p/${pid}/${key}` : `/p/${pid}`;
    navigate(url);
  };

  const actions = Number(pid) !== 0 ? (
    <>
      <Button size="sm" variant="secondary" onClick={rebuild}>
        <RefreshCw size={13} /> {t("project.rebuild")}
      </Button>
      <Button size="sm" variant="destructive" onClick={unregister}>
        {t("admin.unregister")}
      </Button>
    </>
  ) : undefined;

  return (
    <TabLayout
      sections={sections}
      active={active}
      onChange={onTabChange}
      collapsed={collapsed}
      onToggleCollapse={toggle}
      actions={actions}
      contentClassName="w-full space-y-6 p-6 pt-3"
      testId={`project-tab-${active || "overview"}`}
    >
      <Routes>
        <Route index               element={<Overview pid={pid} />} />
        <Route path="workspaces"   element={<WorkspacesTab />} />
        <Route path="models"       element={<ModelsTab />} />
        <Route path="agent-defaults" element={<AgentDefaultsTab />} />
        <Route path="sessions"     element={<SessionsTab />} />
        <Route path="logs"         element={<LogsTab pid={pid} />} />
        <Route path="config"       element={<ConfigTab pid={pid} />} />
        <Route path="telegram"     element={<TelegramTab pid={pid} />} />
        <Route path="agents"       element={<AgentsTab pid={pid} />} />
        <Route path="agents/:slug" element={<AgentDetailScreen pid={pid} />} />
        <Route path="memories"     element={<MemoriesTab pid={pid} />} />
        <Route path="routines"     element={<RoutinesTab pid={pid} />} />
        <Route path="tasks"        element={isBase ? <GlobalTasksTab /> : <TasksTab pid={pid} />} />
        <Route path="mcps"         element={<McpsTab pid={pid} />} />
        <Route path="threads"      element={<ThreadsTab pid={pid} />} />
        <Route path="chat"         element={<ChatTab pid={pid} />} />
        <Route path="*"            element={<Overview pid={pid} />} />
      </Routes>
    </TabLayout>
  );
}
