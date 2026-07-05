import { useMemo } from "react";
import { useParams, Routes, Route, Navigate, useLocation, useNavigate } from "react-router-dom";
import {
  Bot, Heart, Zap, Puzzle, FolderKanban, Settings,
  MessagesSquare, Send, KeyRound,
  LayoutDashboard, Boxes, Cpu, ScrollText, History, Brain, FileCode2, Cable,
  Building2, FileText, FolderTree, Sparkles,
} from "lucide-react";
import { useNavCollapse, type TabSection } from "../components/common/TabNav";
import { TabLayout } from "../components/common/TabLayout";
import { RobyEmpty } from "../components/Roby";
import { Button } from "../components/ui/button";
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
import { IntegrationsTab } from "./project/IntegrationsTab";
import { VarsTab } from "./project/VarsTab";
import { ChatTab } from "./project/ChatTab";
import { TelegramTab } from "./project/TelegramTab";
import { MemoriesTab } from "./project/MemoriesTab";
import { ArtifactsTab } from "./project/ArtifactsTab";
import { AgentDetailScreen } from "./project/AgentDetailScreen";
import { StructureTab } from "./project/StructureTab";
import { DocsTab } from "./project/DocsTab";
import { FilesTab } from "./project/FilesTab";
import { SkillsTab } from "./project/SkillsTab";

type NavKey =
  | "" | "chat" | "config" | "telegram"
  | "agents" | "routines" | "tasks" | "mcps" | "integrations" | "vars" | "logs" | "memories" | "artifacts"
  | "structure" | "docs" | "files" | "skills";

export function ProjectScreen() {
  const navigate = useNavigate();
  const location = useLocation();
  const { pid = "" } = useParams();
  const { project } = useProject(pid);
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
            { key: "skills",   label: t("skills_page.title"),    icon: Sparkles },
            { key: "routines",  label: t("project.nav.routines"),  icon: Heart },
            { key: "mcps",      label: t("project.nav.mcps"),      icon: Puzzle },
            { key: "integrations", label: "Integrations",          icon: Cable },
            { key: "vars",      label: t("project.nav.vars"),      icon: KeyRound },
            { key: "artifacts", label: t("project.nav.artifacts"), icon: FileCode2 },
            { key: "config",    label: t("project.nav.config"),    icon: Settings },
          ],
        },
      ];
    }
    // Structure (org roles/areas) is only meaningful for company/enterprise
    // projects — gate it on the project kind.
    const isCompany = project?.kind === "company";
    return [
      {
        title: t("project.sections.workspace"),
        items: [
          { key: "",         label: t("project.nav.overview"),  icon: FolderKanban },
          { key: "telegram", label: t("project.nav.telegram"),  icon: Send },
          { key: "chat",     label: t("project.nav.chat"),      icon: MessagesSquare },
          { key: "agents",   label: t("project.nav.agents"),    icon: Bot },
          ...(isCompany ? [{ key: "structure", label: t("project.nav.structure"), icon: Building2 }] : []),
          { key: "memories", label: t("project.nav.memories"),  icon: Brain },
          { key: "skills",   label: t("skills_page.title"),     icon: Sparkles },
        ],
      },
      {
        title: t("project.sections.content"),
        items: [
          { key: "docs",  label: t("project.nav.docs"),  icon: FileText },
          { key: "files", label: t("project.nav.files"), icon: FolderTree },
        ],
      },
      {
        title: t("project.sections.automation"),
        items: [
          { key: "routines",  label: t("project.nav.routines"),  icon: Heart },
          { key: "tasks",     label: t("project.nav.tasks"),     icon: Zap },
          { key: "mcps",      label: t("project.nav.mcps"),      icon: Puzzle },
          { key: "integrations", label: "Integrations",          icon: Cable },
          { key: "vars",      label: t("project.nav.vars"),      icon: KeyRound },
          { key: "artifacts", label: t("project.nav.artifacts"), icon: FileCode2 },
          { key: "logs",      label: t("project.nav.logs"),      icon: ScrollText },
        ],
      },
      {
        title: t("project.sections.config"),
        items: [
          { key: "config",   label: t("project.nav.config"),    icon: Settings },
        ],
      },
    ];
  }, [isBase, project?.kind]);

  // First path segment after /p/:pid — so deep routes like agents/:slug still
  // highlight the "agents" nav item.
  const active = (location.pathname.replace(`/p/${pid}`, "").replace(/^\//, "").split("/")[0]) as NavKey;

  if (!project) {
    return (
      <RobyEmpty
        testId="screen-project-not-found"
        mood="confused"
        message={t("project.not_found", { pid })}
        action={
          <Button variant="outline" onClick={() => navigate("/")}>
            {t("not_found.home")}
          </Button>
        }
      />
    );
  }

  const onTabChange = (key: string) => {
    const url = key ? `/p/${pid}/${key}` : `/p/${pid}`;
    navigate(url);
  };

  return (
    <TabLayout
      sections={sections}
      active={active}
      onChange={onTabChange}
      collapsed={collapsed}
      onToggleCollapse={toggle}
      contentClassName="w-full space-y-6 py-6 pt-3 pr-6 pl-1"
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
        <Route path="structure"    element={<StructureTab pid={pid} />} />
        <Route path="docs"         element={<DocsTab pid={pid} />} />
        <Route path="files"        element={<FilesTab pid={pid} />} />
        <Route path="memories"     element={<MemoriesTab pid={pid} />} />
        <Route path="skills"       element={<SkillsTab pid={pid} />} />
        <Route path="routines"     element={<RoutinesTab pid={pid} />} />
        <Route path="tasks"        element={isBase ? <GlobalTasksTab /> : <TasksTab pid={pid} />} />
        <Route path="mcps"         element={<McpsTab pid={pid} />} />
        <Route path="integrations" element={<IntegrationsTab pid={pid} />} />
        <Route path="artifacts"    element={<ArtifactsTab pid={pid} />} />
        <Route path="vars"         element={<VarsTab pid={pid} />} />
        <Route path="threads"      element={<Navigate to={`/p/${pid}/chat`} replace />} />
        <Route path="chat"         element={<ChatTab pid={pid} />} />
        <Route path="*"            element={<Overview pid={pid} />} />
      </Routes>
    </TabLayout>
  );
}
