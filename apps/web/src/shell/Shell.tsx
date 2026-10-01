import type { CSSProperties } from "react";
import { useEffect } from "react";
import { AppScreen } from "../apps/AppScreen.tsx";
import { ConfigModal } from "../config/ConfigModal.tsx";
import { usePrefs } from "../data/prefs.ts";
import { data } from "../data/state.ts";
import { ProjectScreen } from "../project/ProjectScreen.tsx";
import { SoonScreen } from "../project/SoonPane.tsx";
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
  const layout = computeLayout(width, panelOpen, chat && threadId != null, transcript);
  useShortcuts();

  return (
    <div className="shell" style={layoutVars(layout) as CSSProperties}>
      <Topbar />
      <OfflineBanner />
      <div className="shell__body">
        <Sidebar rail={layout.rail} />
        <main className="shell__main">
          {view === "app" ? (
            <AppScreen />
          ) : view === "project" ? (
            <ProjectScreen layout={layout} />
          ) : view === "tasks" || view === "resources" ? (
            <SoonScreen kind={view} />
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
