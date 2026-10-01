import type { CSSProperties } from "react";
import { AppScreen } from "../apps/AppScreen.tsx";
import { ChatView } from "../chat/ChatView.tsx";
import { InboxList } from "../inbox/InboxList.tsx";
import { SidePanel } from "../panel/SidePanel.tsx";
import { computeLayout, layoutVars } from "./layout.ts";
import { useNav } from "./nav.ts";
import { OfflineBanner } from "./OfflineBanner.tsx";
import { Sidebar } from "./Sidebar.tsx";
import { Toasts } from "./Toasts.tsx";
import { Topbar } from "./Topbar.tsx";
import { useViewportWidth } from "./useViewportWidth.ts";

/** Topbar · Sidebar · main (Inbox list + Chat + side panel, or a fullscreen App). See SPEC §1. */
export function Shell() {
  const width = useViewportWidth();
  const view = useNav((s) => s.view);
  const panel = useNav((s) => s.panel);
  const threadId = useNav((s) => s.threadId);
  const showChat = view === "inbox";
  const panelOpen = showChat && panel != null;
  const layout = computeLayout(width, panelOpen, showChat && threadId != null);

  return (
    <div className="shell" style={layoutVars(layout) as CSSProperties}>
      <Topbar />
      <OfflineBanner />
      <div className="shell__body">
        <Sidebar rail={layout.rail} />
        <main className="shell__main">
          {view === "app" ? (
            <AppScreen />
          ) : (
            <>
              {layout.listW > 0 && <InboxList />}
              <ChatView wideHeader={layout.wideHeader} />
              {panelOpen && <SidePanel />}
            </>
          )}
        </main>
      </div>
      <Toasts />
    </div>
  );
}
