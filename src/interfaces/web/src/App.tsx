import { Route, Routes, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { Moon, Sun } from "lucide-react";
import { ProjectSidebar } from "./components/layout/ProjectSidebar";
import { ApxAdminScreen } from "./screens/ApxAdminScreen";
import { ProjectScreen } from "./screens/ProjectScreen";
import { SettingsScreen } from "./screens/SettingsScreen";
import { AddProjectDialog } from "./components/AddProjectDialog";
import { PairingScreen } from "./screens/PairingScreen";
import { RobyBubble } from "./components/RobyBubble";
import { ToastProvider } from "./components/Toast";
import { TooltipProvider } from "./components/ui/tooltip";
import { useTheme } from "./hooks/useTheme";
import { useProjects } from "./hooks/useProjects";
import { useTokenBootstrap } from "./hooks/useTokenBootstrap";
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

  const closeAdd = () => {
    const next = new URLSearchParams(params);
    next.delete("action");
    setParams(next, { replace: true });
  };

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background text-foreground" data-testid="app-shell">
      <ProjectSidebar onSelect={(href) => navigate(href)} />
      <main className="m-2 ml-0 flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        <TopBar onToggleTheme={toggle} isDark={theme === "dark"} pathname={location.pathname} />
        <div className="flex-1 overflow-y-auto">
          <Routes>
            <Route path="/"           element={<ApxAdminScreen />} />
            <Route path="/settings/*" element={<SettingsScreen />} />
            <Route path="/p/:pid/*"   element={<ProjectScreen />} />
            <Route path="*"           element={<NotFound />} />
          </Routes>
        </div>
      </main>
      <AddProjectDialog open={addOpen} onClose={closeAdd} />
      {/* Always-on floating shortcut to chat with Roby (the super-agent).
          Visible on every authenticated screen; calls /projects/0/super-agent/chat. */}
      <RobyBubble />
    </div>
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
  return (
    <header className="flex h-11 shrink-0 items-center justify-between px-4">
      <span className="text-xs tracking-wide text-muted-fg">{crumb}</span>
      <button
        type="button"
        onClick={onToggleTheme}
        title={isDark ? t("topbar.light") : t("topbar.dark")}
        className="rounded-md p-1.5 text-muted-fg hover:bg-accent hover:text-accent-fg"
      >
        {isDark ? <Sun size={16} /> : <Moon size={16} />}
      </button>
    </header>
  );
}

function settingsLabel(key?: string) {
  switch (key) {
    case "super-agent": return t("settings.tabs.super_agent");
    case "engines": return "Modelos";
    case "telegram": return t("settings.tabs.telegram");
    case "devices": return t("settings.tabs.devices");
    case "appearance": return t("settings.appearance");
    case "config":
    case "advanced": return "Config";
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
    case "workspaces": return "Workspaces";
    case "models": return "Models";
    case "agent-defaults": return "Agent defaults";
    case "sessions": return "Sessions";
    case "logs": return "Logs";
    case "memories": return "Memorias";
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
      <h1 className="text-2xl">404</h1>
      <p className="text-muted-fg">Esa ruta no existe.</p>
    </div>
  );
}
