import type { CSSProperties } from "react";
import { Suspense, useEffect } from "react";
import { applyDesktopPrefs } from "../config/desktopPrefs.ts";
import { useSlice } from "../data/createStore.ts";
import { usePrefs } from "../data/prefs.ts";
import { data } from "../data/state.ts";
import { useThreadDialog } from "../data/threadAdmin.ts";
import {
  AppScreen,
  ChannelScreen,
  CommandPalette,
  ComputersScreen,
  ConfigModal,
  CornerCards,
  EngineSessions,
  InstallArtifactDialog,
  LiveLayer,
  PhoneDialog,
  ProjectScreen,
  ResourcesScreen,
  TaskPeek,
  TasksScreen,
  ThreadDialogs,
  UsageDialog,
  WelcomeV2,
  WidgetChatHost,
} from "../lazy.ts";
import { useAnyLive } from "../surfaces/liveAny.ts";
import { useApxFiles } from "../surfaces/openedFiles.ts";
import { widgetChatOpen } from "../surfaces/widgetChatOpen.ts";
import { ChatWorkspace } from "./ChatWorkspace.tsx";
import { computeLayout, layoutVars } from "./layout.ts";
import { go, nav, showsChat, useNav } from "./nav.ts";
import { OfflineBanner } from "./OfflineBanner.tsx";
import { Sidebar } from "./Sidebar.tsx";
import { Toasts } from "./Toasts.tsx";
import { Topbar } from "./Topbar.tsx";
import { UpdateDialogHost } from "./UpdatePill.tsx";
import { ShellLayout } from "./useShellLayout.ts";
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
  const config = useNav((s) => s.config != null);
  const palette = useNav((s) => s.palette);
  const threadDialog = useThreadDialog() != null;
  const phone = useNav((s) => s.phone);
  const usageDialog = useNav((s) => s.usageDialog);
  // A task opened from a chat floats over it; the Tasks screen shows its own beside the list.
  const peek = useNav((s) => s.peekTaskId != null && s.view !== "tasks");
  const widgetChat = useSlice(widgetChatOpen, (s) => s.threadId != null);
  const live = useAnyLive();
  const panelWide = useNav((s) => s.panelWide);
  const layout = computeLayout(width, panelOpen, chat && threadId != null, transcript, { ...own, panelWide });
  useShortcuts();
  useDesktopBridge();

  return (
    <div className="shell" style={layoutVars(layout) as CSSProperties}>
      <Topbar />
      <OfflineBanner />
      <div className="shell__body">
        <Sidebar rail={layout.rail} width={layout.sidebarW} />
        <main className="shell__main">
          <ShellLayout.Provider value={layout}>
            <Suspense fallback={null}>
              {view === "app" ? (
                <AppScreen />
              ) : view === "project" ? (
                <ProjectScreen layout={layout} />
              ) : view === "tasks" ? (
                <TasksScreen />
              ) : view === "resources" ? (
                <ResourcesScreen />
              ) : view === "computers" ? (
                <ComputersScreen />
              ) : view === "channel" ? (
                <ChannelScreen />
              ) : view === "engine" ? (
                <ChatWorkspace layout={layout} list={<EngineSessions />} />
              ) : (
                <ChatWorkspace layout={layout} />
              )}
            </Suspense>
          </ShellLayout.Provider>
        </main>
      </div>
      <Suspense fallback={null}>
        <InstallArtifactDialog />
      </Suspense>
      {config && (
        <Suspense fallback={null}>
          <ConfigModal />
        </Suspense>
      )}
      {palette && (
        <Suspense fallback={null}>
          <CommandPalette />
        </Suspense>
      )}
      {threadDialog && (
        <Suspense fallback={null}>
          <ThreadDialogs />
        </Suspense>
      )}
      {phone && (
        <Suspense fallback={null}>
          <PhoneDialog />
        </Suspense>
      )}
      {usageDialog && (
        <Suspense fallback={null}>
          <UsageDialog />
        </Suspense>
      )}
      {widgetChat && (
        <Suspense fallback={null}>
          <WidgetChatHost />
        </Suspense>
      )}
      {peek && (
        <Suspense fallback={null}>
          <TaskPeek />
        </Suspense>
      )}
      <UpdateDialogHost />
      {/* It knows on its own whether it was seen: the first screen carries none of it. */}
      <Suspense fallback={null}>
        <WelcomeV2 />
      </Suspense>
      {/* Over the foot of the list column: on a phone, or with the list hidden, it would cover the composer. */}
      {layout.rail && !layout.compact && layout.listW > 0 && (
        <Suspense fallback={null}>
          <CornerCards floating />
        </Suspense>
      )}
      {live && (
        <Suspense fallback={null}>
          <LiveLayer />
        </Suspense>
      )}
      <Toasts />
    </div>
  );
}

/** ⌘K searches, ⌘, opens Config, ⌘J jumps to the super-agent's chat, ⌘[ / ⌘] go back/forward. */
function useShortcuts() {
  useEffect(() => {
    const resetHints = () => document.documentElement.removeAttribute("data-shortcuts-active");
    const updateHints = (e: KeyboardEvent) => {
      document.documentElement.toggleAttribute(
        "data-shortcuts-active",
        (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey,
      );
    };
    const onVisibility = () => {
      if (document.hidden) resetHints();
    };
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      // Alt+← / Alt+→ also step places (same idea as a browser).
      if (e.altKey && !mod && !e.shiftKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
        e.preventDefault();
        if (e.key === "ArrowLeft") go.back();
        else go.forward();
        return;
      }
      if (!mod || e.altKey || e.shiftKey) return;
      if (e.key === "k" || e.key === "K") {
        e.preventDefault();
        go.palette(true);
      } else if (e.key === ",") {
        e.preventDefault();
        go.config();
      } else if (e.key === "j" || e.key === "J") {
        const home = Object.values(data.get().threads).find((t) => t.kind === "home");
        if (!home) return;
        e.preventDefault();
        go.inboxThread(home.id);
      } else if (e.key === "[" || e.code === "BracketLeft") {
        e.preventDefault();
        go.back();
      } else if (e.key === "]" || e.code === "BracketRight") {
        e.preventDefault();
        go.forward();
      }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keydown", updateHints, true);
    window.addEventListener("keyup", updateHints, true);
    window.addEventListener("blur", resetHints);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keydown", updateHints, true);
      window.removeEventListener("keyup", updateHints, true);
      window.removeEventListener("blur", resetHints);
      document.removeEventListener("visibilitychange", onVisibility);
      resetHints();
    };
  }, []);
}

/** In the desktop app: apply its settings once, and open the chat the quick window hands over. */
function useDesktopBridge() {
  useEffect(() => {
    void applyDesktopPrefs();
    window.apxDesktop?.setTitleBar?.(nav.get().mode);
    return window.apxDesktop?.onOpenThread?.((id) => go.thread(id));
  }, []);
  useApxFiles();
}
