import { ContextMenu, Icons, NavItem, ResizeHandle } from "@apx/ui";
import { Suspense, useEffect, useMemo } from "react";
import { useAccountCounts } from "../channels/counts.ts";
import { markAllRead } from "../data/actions.ts";
import { loadChannels } from "../data/channels.ts";
import { inInbox } from "../data/identity.ts";
import { setPrefs, usePrefs } from "../data/prefs.ts";
import { useData } from "../data/state.ts";
import { useT } from "../i18n/index.ts";
import { unreadListed } from "../inbox/groupThreads.ts";
import { NewChatMenu } from "../inbox/NewChatMenu.tsx";
import { AppsDock, CornerCards, DesktopInstallNotice } from "../lazy.ts";
import { AccountRow } from "./AccountRow.tsx";
import { ChannelsNav } from "./ChannelsNav.tsx";
import { DiskMark } from "./DiskMark.tsx";
import { ExternalSessionsNav } from "./ExternalSessionsNav.tsx";
import { HelpMenu } from "./HelpMenu.tsx";
import { LAYOUT } from "./layout.ts";
import { go, useNav } from "./nav.ts";
import { ProjectsNav } from "./ProjectsNav.tsx";
import { SidebarTooltipButton } from "./SidebarNavRow.tsx";
import { useSidebarCompact } from "./useSidebarCompact.ts";

/**
 * New chat · Inbox · Tasks · Flows · Routines · Resources · Files (pinned) · Projects · External sessions · Channels ·
 * Apps · account (with Settings). Compact (the owner's choice, or a short window): each section is one row. `rail` = 60px icons. Its edge folds and unfolds it (click or drag) and sets its width; `narrow`: the
 * window is narrow enough to fold it on its own; `fixed`: a phone, where it stays a rail.
 */
export function Sidebar({
  rail,
  width,
  narrow,
  fixed,
}: {
  rail: boolean;
  width: number;
  narrow: boolean;
  fixed: boolean;
}) {
  const t = useT();
  const view = useNav((s) => s.view);
  const threads = useData((s) => s.threads);
  const computers = useData((s) => s.computers.shown);
  const screensInUse = useData((s) => s.computers.inUse);
  const accountCounts = useAccountCounts();
  const channelsAttention = [...accountCounts.values()].reduce((n, c) => n + c.unread + c.waiting, 0);
  useEffect(() => {
    void loadChannels();
  }, []);

  const compact = useSidebarCompact();
  const routines = usePrefs((s) => s.inboxRoutines);
  // The width it opens to: the one the owner dragged it to.
  const open = usePrefs((s) => s.sidebarW) || undefined;
  // The same chats the Inbox's own button reads.
  const unreadIds = useMemo(() => unreadListed(threads, { routines }), [threads, routines]);
  const unread = useMemo(() => {
    let n = 0;
    for (const t of Object.values(threads)) if (inInbox(t, routines)) n += t.unread;
    return n;
  }, [threads, routines]);

  return (
    <aside className={rail ? "sidebar is-rail" : "sidebar"} aria-label={t("nav.label")}>
      {!fixed && (
        <ResizeHandle
          className="sidebar__resize"
          width={rail ? (open ?? LAYOUT.sidebarW) : width}
          min={LAYOUT.sidebarMinW}
          max={LAYOUT.sidebarMaxW}
          onResize={(w) => setPrefs({ sidebarW: w })}
          collapsed={rail}
          collapsedWidth={LAYOUT.sidebarRailW}
          onCollapsedChange={(fold) =>
            setPrefs(
              fold ? { sidebarCollapsed: true, sidebarOpen: false } : { sidebarCollapsed: false, sidebarOpen: narrow },
            )
          }
          label={t("nav.resize")}
          hint={t(rail ? "nav.unfoldHint" : "nav.resizeHint")}
        />
      )}
      <div className="sidebar__top">
        <NewChatMenu
          projectId={undefined}
          trigger={
            <SidebarTooltipButton
              label={t("nav.newChat")}
              className={`apx-nav sidebar__newchat${rail ? " apx-nav--collapsed" : ""}`}
            >
              <span className="apx-nav__icon">
                <Icons.SquarePen size={16} />
              </span>
              {!rail && <span className="apx-nav__label">{t("nav.newChat")}</span>}
            </SidebarTooltipButton>
          }
        />
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
          icon={<Icons.GitBranch />}
          label={t("nav.flows")}
          active={view === "flows"}
          onClick={() => go.flows()}
        />
        <NavItem
          collapsed={rail}
          icon={<Icons.Clock />}
          label={t("nav.routines")}
          active={view === "routines"}
          onClick={() => go.view("routines")}
        />
        <NavItem
          collapsed={rail}
          icon={<Icons.Layers />}
          label={t("nav.resources")}
          active={view === "resources"}
          onClick={() => go.view("resources")}
        />
        <NavItem
          collapsed={rail}
          icon={<Icons.Paperclip />}
          label={t("nav.files")}
          active={view === "files"}
          onClick={() => go.view("files")}
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
        <NavItem
          collapsed={rail}
          icon={<Icons.MessageCircle />}
          label={t("nav.channels")}
          count={channelsAttention || undefined}
          active={view === "channels"}
          onClick={() => go.view("channels")}
        />
      </div>
      <div className={compact ? "sidebar__scroll is-compact" : "sidebar__scroll"}>
        <ProjectsNav rail={rail} compact={compact} />

        <ExternalSessionsNav rail={rail} compact={compact} />

        <ChannelsNav rail={rail} compact={compact} />

        <Suspense fallback={null}>
          <AppsDock rail={rail} compact={compact} />
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
        <DiskMark rail={rail} />
        <HelpMenu rail={rail} />
        <AccountRow rail={rail} />
      </div>
    </aside>
  );
}
