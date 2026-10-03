import type { CSSProperties } from "react";
import { useEffect } from "react";
import { AppScreen } from "../apps/AppScreen.tsx";
import { ChannelScreen } from "../channels/ChannelScreen.tsx";
import { ConfigModal } from "../config/ConfigModal.tsx";
import { applyDesktopPrefs } from "../config/DesktopSection.tsx";
import { usePrefs } from "../data/prefs.ts";
import { data } from "../data/state.ts";
import { EngineSessions } from "../engines/EngineSessions.tsx";
import { ProjectScreen } from "../project/ProjectScreen.tsx";
import { ResourcesScreen } from "../project/ResourcesScreen.tsx";
import { TasksScreen } from "../tasks/TasksScreen.tsx";
import { ChatWorkspace } from "./ChatWorkspace.tsx";
import { computeLayout, layoutVars } from "./layout.ts";
import { go, showsChat, useNav } from "./nav.ts";
import { OfflineBanner } from "./OfflineBanner.tsx";
import { PhoneDialog } from "./PhoneDialog.tsx";
import { Sidebar } from "./Sidebar.tsx";
import { Toasts } from "./Toasts.tsx";
import { Topbar } from "./Topbar.tsx";
import { useViewportWidth } from "./useViewportWidth.ts";

/** Topbar · Sidebar · main (chat workspace, a project, an app or a placeholder view). See SPEC §1. */
export function Shell() {
  const width = useViewportWidth();
  const view = useNav((s) => s.view);
  const chat = useNav(showsChat);
  const panel = useNav((s) => s.panel);
  const threadId = useNav((s) => s.threadId);
  const transcript = usePrefs((s) => s.transcriptWidth);
  const panelOpen = chat && panel != null;
  const own = usePrefs((s) => s);
  const layout = computeLayout(width, panelOpen, chat && threadId != null, transcript, own);
  useShortcuts();
  useDesktopBridge();

  return (
    <div className="shell" style={layoutVars(layout) as CSSProperties}>
      <Topbar />
      <OfflineBanner />
      <div className="shell__body">
        <Sidebar rail={layout.rail} width={layout.sidebarW} />
        <main className="shell__main">
          {view === "app" ? (
            <AppScreen />
          ) : view === "project" ? (
            <ProjectScreen layout={layout} />
          ) : view === "tasks" ? (
            <TasksScreen />
          ) : view === "resources" ? (
            <ResourcesScreen />
          ) : view === "channel" ? (
            <ChannelScreen />
          ) : view === "engine" ? (
            <ChatWorkspace layout={layout} list={<EngineSessions />} />
          ) : (
            <ChatWorkspace layout={layout} />
          )}
        </main>
      </div>
      <ConfigModal />
      <PhoneDialog />
      <Toasts />
    </div>
  );
}

/** ⌘, opens Config; ⌘J jumps to the super-agent's chat. */
function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return;
      if (e.key === ",") {
        e.preventDefault();
        go.config();
      } else if (e.key === "j" || e.key === "J") {
        const home = Object.values(data.get().threads).find((t) => t.kind === "home");
        if (!home) return;
        e.preventDefault();
        go.inboxThread(home.id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

/** In the desktop app: apply its settings once, and open the chat the quick window hands over. */
function useDesktopBridge() {
  useEffect(() => {
    void applyDesktopPrefs();
    window.apxDesktop?.onOpenThread?.((id) => go.thread(id));
  }, []);
}
