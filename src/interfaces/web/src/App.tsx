import { useState } from "react";
import { Route, Routes, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { Moon, Sun } from "lucide-react";
import { ProjectSidebar, projectKindLabel } from "./components/layout/ProjectSidebar";
import { ApxAdminScreen } from "./screens/ApxAdminScreen";
import { ProjectScreen } from "./screens/ProjectScreen";
import { SettingsScreen } from "./screens/SettingsScreen";
import { VoiceScreen } from "./screens/modules/VoiceScreen";
import { DesktopScreen } from "./screens/modules/DesktopScreen";
import { DeckScreen } from "./screens/modules/DeckScreen";
import { CodeScreen } from "./screens/modules/CodeScreen";
import { AddProjectDialog } from "./components/AddProjectDialog";
import { PairingScreen } from "./screens/PairingScreen";
import { RobyBubble } from "./components/RobyBubble";
import { ToastProvider } from "./components/Toast";
import { TooltipProvider } from "./components/ui/tooltip";
import { useTheme } from "./hooks/useTheme";
import { useProjects } from "./hooks/useProjects";
import { useTokenBootstrap } from "./hooks/useTokenBootstrap";
import { NavCollapseProvider, useNavCollapseCtx } from "./hooks/useNavCollapseCtx";
import { NavToggle } from "./components/common/TabNav";
import { t } from "./i18n";

export function App() {
  const auth = useTokenBootstrap();

  if (auth.status === "loading") {
    return <Splash text={t("daemon.connecting")} />;
  }
  if (auth.status === "error") {
    return (
      <Splash
        text={t("daemon.unreachable")}
        sub={`${t("daemon.unreachable_hint")}\n\n${auth.reason}`}
      />
    );
  }
  if (auth.status === "unpaired") {
    return <PairingScreen onPaired={auth.reload} />;
  }

  return (
    <ToastProvider>
      <TooltipProvider delay={300}>
        <Shell />
      </TooltipProvider>
    </ToastProvider>
  );
}

function Shell() {
  const navigate = useNavigate();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const { theme, toggle } = useTheme();
  const addOpen = params.get("action") === "add-project";
  const [robyOpen, setRobyOpen] = useState(false);

  const closeAdd = () => {
    const next = new URLSearchParams(params);
    next.delete("action");
    setParams(next, { replace: true });
  };

  return (
    <NavCollapseProvider>
      <div className="flex h-screen w-screen overflow-hidden bg-background text-foreground" data-testid="app-shell">
        <ProjectSidebar onSelect={(href) => navigate(href)} onOpenRoby={() => setRobyOpen(true)} />
        <main className="m-2 ml-0 flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-card shadow-sm">
          <TopBar onToggleTheme={toggle} isDark={theme === "dark"} pathname={location.pathname} />
          <div className="flex-1 overflow-y-auto">
            <Routes>
              <Route path="/"           element={<ApxAdminScreen />} />
              <Route path="/settings/*" element={<SettingsScreen />} />
              <Route path="/m/voice/*"   element={<VoiceScreen />} />
              <Route path="/m/desktop/*" element={<DesktopScreen />} />
              <Route path="/m/deck/*"   element={<DeckScreen />} />
              <Route path="/m/code/*"   element={<CodeScreen />} />
              <Route path="/p/:pid/*"   element={<ProjectScreen />} />
              <Route path="*"           element={<NotFound />} />
            </Routes>
          </div>
        </main>
        <AddProjectDialog open={addOpen} onClose={closeAdd} />
        {/* Roby (the super-agent) chat sheet. Launcher lives in the rail (below
            Settings); open state is owned here so the rail can trigger it. */}
        <RobyBubble open={robyOpen} onOpenChange={setRobyOpen} />
      </div>
    </NavCollapseProvider>
  );
}

function TopBar({
  onToggleTheme,
  isDark,
  pathname,
}: {
  onToggleTheme: () => void;
  isDark: boolean;
  pathname: string;
}) {
  const { projects } = useProjects();
  const parts = pathname.split("/").filter(Boolean);
  const project = parts[0] === "p" ? projects.find((p) => String(p.id) === parts[1]) : undefined;
  const section = parts[0] === "settings"
    ? settingsLabel(parts[1])
    : parts[0] === "p"
      ? projectLabel(parts[2])
      : "";
  const isDefault = parts[0] === "p" && parts[1] === "0";
  const projName = project?.name || project?.path?.split("/").pop() || t("nav.project");
  const crumb = pathname === "/"
    ? t("topbar.breadcrumb_root")
    : parts[0] === "settings"
      ? [t("topbar.breadcrumb_root"), t("nav.settings"), section].filter(Boolean).join(" › ")
      : parts[0] === "p"
        ? (isDefault
            ? [t("topbar.breadcrumb_root"), t("topbar.breadcrumb_base"), section].filter(Boolean).join(" › ")
            : [t("topbar.breadcrumb_root"), t("topbar.breadcrumb_projects"), projName, section].filter(Boolean).join(" › "))
        : t("topbar.breadcrumb_root");
  const subtitle = pathname === "/"
    ? ""
    : parts[0] === "settings"
      ? t("settings.subtitle")
      : parts[0] === "p"
        ? (isDefault
            ? t("base.subtitle")
            : project ? `${projectKindLabel(project.kind)} · ${project.path}` : "")
        : "";
  const nav = useNavCollapseCtx();
  return (
    <header className="flex h-10 shrink-0 items-center gap-2 border-b border-border/50 px-3">
      {nav && <NavToggle collapsed={nav.collapsed} onToggle={nav.toggle} />}
      <span className="min-w-0 flex-1 truncate text-[11px] tracking-wide text-muted-fg">
        {crumb}
        {subtitle && <span className="text-muted-fg/50"> · {subtitle}</span>}
      </span>
      <button
        type="button"
        onClick={onToggleTheme}
        title={isDark ? t("topbar.light") : t("topbar.dark")}
        className="shrink-0 rounded-md p-1.5 text-muted-fg hover:bg-accent hover:text-accent-fg"
      >
        {isDark ? <Sun size={14} /> : <Moon size={14} />}
      </button>
    </header>
  );
}

function settingsLabel(key?: string) {
  switch (key) {
    case "super-agent": return t("settings.tabs.super_agent");
    case "engines": return t("settings.tabs.engines");
    case "telegram": return t("settings.tabs.telegram");
    case "devices": return t("settings.tabs.devices");
    case "appearance": return t("settings.appearance");
    case "config":
    case "advanced": return t("settings.tabs.advanced");
    case "identity":
    default: return key ? key : "";
  }
}

function projectLabel(key?: string) {
  switch (key) {
    case "chat": return t("project.nav.chat");
    case "threads": return t("project.nav.threads");
    case "telegram": return t("project.nav.telegram");
    case "agents": return t("project.nav.agents");
    case "routines": return t("project.nav.routines");
    case "tasks": return t("project.nav.tasks");
    case "mcps": return t("project.nav.mcps");
    case "config": return t("project.nav.config");
    case "workspaces": return t("base.workspaces_title");
    case "models": return t("settings.tabs.engines");
    case "agent-defaults": return t("base.defaults_title");
    case "sessions": return t("base.sessions_title");
    case "logs": return t("project.nav.logs");
    case "memories": return t("project.nav.memories");
    default: return "";
  }
}

function Splash({ text, sub }: { text: string; sub?: string }) {
  return (
    <div className="grid h-screen w-screen place-items-center bg-background text-foreground">
      <div className="text-center">
        <div className="font-mono text-xs text-muted-fg whitespace-pre leading-none mb-4">
          {"  ▄███████▄\n █ ██   ██ █\n █  ◔   ◔  █\n █   ╰~╯   █\n  ▀███████▀"}
        </div>
        <div className="text-foreground">{text}</div>
        {sub && <pre className="mt-2 max-w-xl whitespace-pre-wrap text-sm text-muted-fg">{sub}</pre>}
      </div>
    </div>
  );
}

function NotFound() {
  return (
    <div className="p-8">
      <h1 className="text-2xl">{t("not_found.title")}</h1>
      <p className="text-muted-fg">{t("not_found.message")}</p>
    </div>
  );
}
