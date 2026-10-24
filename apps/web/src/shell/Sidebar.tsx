import { ContextMenu, Icons, NavItem, ResizeHandle } from "@apx/ui";
import { Suspense, useEffect, useMemo } from "react";
import { markAllRead } from "../data/actions.ts";
import { loadChannels } from "../data/channels.ts";
import { inInbox } from "../data/identity.ts";
import { setPrefs, usePrefs } from "../data/prefs.ts";
import { useData } from "../data/state.ts";
import { useT } from "../i18n/index.ts";
import { unreadListed } from "../inbox/groupThreads.ts";
import { AppsDock, CornerCards, DesktopInstallNotice } from "../lazy.ts";
import { AccountRow } from "./AccountRow.tsx";
import { ChannelsNav } from "./ChannelsNav.tsx";
import { ExternalSessionsNav } from "./ExternalSessionsNav.tsx";
import { LAYOUT } from "./layout.ts";
import { go, useNav } from "./nav.ts";
import { ProjectsNav } from "./ProjectsNav.tsx";

/** Inbox · Tasks · Resources (pinned) · Channels · Projects · External sessions · Apps · account (with Settings). `rail` = 60px icons. */
export function Sidebar({ rail, width }: { rail: boolean; width: number }) {
  const t = useT();
  const view = useNav((s) => s.view);
  const threads = useData((s) => s.threads);
  const computers = useData((s) => s.computers.shown);
  const screensInUse = useData((s) => s.computers.inUse);
  useEffect(() => {
    void loadChannels();
  }, []);

  const routines = usePrefs((s) => s.inboxRoutines);
  // The same chats the Inbox's own button reads.
  const unreadIds = useMemo(() => unreadListed(threads, { routines }), [threads, routines]);
  const unread = useMemo(() => {
    let n = 0;
    for (const t of Object.values(threads)) if (inInbox(t, routines)) n += t.unread;
    return n;
  }, [threads, routines]);

  return (
    <aside className={rail ? "sidebar is-rail" : "sidebar"} aria-label={t("nav.label")}>
      {!rail && (
        <ResizeHandle
          className="sidebar__resize"
          width={width}
          min={LAYOUT.sidebarMinW}
          max={LAYOUT.sidebarMaxW}
          onResize={(w) => setPrefs({ sidebarW: w })}
          onReset={() => setPrefs({ sidebarW: 0 })}
          label={t("nav.resize")}
        />
      )}
      <div className="sidebar__top">
        <ContextMenu
          items={[
            {
              label: t("inbox.markAllRead"),
              icon: <Icons.CheckCheck />,
              disabled: unreadIds.length === 0,
              onSelect: () => void markAllRead(unreadIds),
            },
          ]}
        >
          <NavItem
            collapsed={rail}
            icon={<Icons.Inbox />}
            label={t("nav.inbox")}
            count={unread}
            active={view === "inbox"}
            onClick={() => go.inbox()}
          />
        </ContextMenu>
        <NavItem
          collapsed={rail}
          icon={<Icons.ListChecks />}
          label={t("nav.tasks")}
          active={view === "tasks"}
          onClick={() => go.view("tasks")}
        />
        <NavItem
          collapsed={rail}
          icon={<Icons.Layers />}
          label={t("nav.resources")}
          active={view === "resources"}
          onClick={() => go.view("resources")}
        />
        {computers && (
          <NavItem
            collapsed={rail}
            icon={<Icons.Monitor />}
            label={t("nav.computers")}
            count={screensInUse || undefined}
            active={view === "computers"}
            onClick={() => go.view("computers")}
          />
        )}
      </div>
      <div className="sidebar__scroll">
        <ChannelsNav rail={rail} />

        <ProjectsNav rail={rail} />

        <ExternalSessionsNav rail={rail} />

        <Suspense fallback={null}>
          <AppsDock rail={rail} />
        </Suspense>
      </div>
      {!rail && (
        <Suspense fallback={null}>
          <CornerCards />
        </Suspense>
      )}
      {!window.apxDesktop && (
        <Suspense fallback={null}>
          <DesktopInstallNotice rail={rail} />
        </Suspense>
      )}
      <div className="sidebar__foot">
        <AccountRow rail={rail} />
      </div>
    </aside>
  );
}
