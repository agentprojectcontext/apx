import { ContextMenu, IconButton, Icons, NavItem, ProjectTile, ResizeHandle } from "@apx/ui";
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { markAllRead } from "../data/actions.ts";
import { pickArtifactFile } from "../data/artifacts.ts";
import { loadChannels } from "../data/channels.ts";
import { inInbox } from "../data/identity.ts";
import { setPrefs, usePrefs } from "../data/prefs.ts";
import { useData } from "../data/state.ts";
import { useT } from "../i18n/index.ts";
import { unreadListed } from "../inbox/groupThreads.ts";
import { ArtifactMemoryDialog } from "../surfaces/ArtifactMemory.tsx";
import { artifactMenu } from "../surfaces/artifactMenu.tsx";
import { AccountRow } from "./AccountRow.tsx";
import { ChannelsNav } from "./ChannelsNav.tsx";
import { ExternalSessionsNav } from "./ExternalSessionsNav.tsx";
import { LAYOUT } from "./layout.ts";
import { go, useNav } from "./nav.ts";
import { ProjectsNav } from "./ProjectsNav.tsx";
import { SidebarSection } from "./SidebarSection.tsx";

// Not needed for the first paint.
const CornerCards = lazy(() => import("./CornerCards.tsx").then((m) => ({ default: m.CornerCards })));
const DesktopInstallNotice = lazy(() =>
  import("./DesktopInstallNotice.tsx").then((m) => ({ default: m.DesktopInstallNotice })),
);

/** Inbox · Tasks · Resources (pinned) · Channels · Projects · External sessions · Apps · account (with Settings). `rail` = 60px icons. */
export function Sidebar({ rail, width }: { rail: boolean; width: number }) {
  const t = useT();
  const view = useNav((s) => s.view);
  const appId = useNav((s) => s.appId);
  const threads = useData((s) => s.threads);
  const surfaces = useData((s) => s.surfaces);
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
  const apps = useMemo(() => Object.values(surfaces).filter((s) => s.app), [surfaces]);
  const [memoryOf, setMemoryOf] = useState<string>();
  const memorySurface = memoryOf ? surfaces[memoryOf] : undefined;

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
      </div>
      <div className="sidebar__scroll">
        <ChannelsNav rail={rail} />

        <ProjectsNav rail={rail} />

        <ExternalSessionsNav rail={rail} />

        {apps.length > 0 && (
          <>
            <SidebarSection
              rail={rail}
              title={t("nav.apps")}
              action={
                <IconButton
                  size="sm"
                  className="sidebar__add"
                  label={t("artifact.import")}
                  icon={<Icons.Upload size={14} />}
                  onClick={() => pickArtifactFile(undefined)}
                />
              }
            />
            {apps.map((a) => (
              <ContextMenu key={a.id} items={artifactMenu(a, t, { onMemory: () => setMemoryOf(a.id) })}>
                <NavItem
                  collapsed={rail}
                  icon={<ProjectTile tone="violet" icon={<Icons.LayoutGrid />} />}
                  label={a.title}
                  active={view === "app" && appId === a.id}
                  onClick={() => go.app(a.id)}
                />
              </ContextMenu>
            ))}
          </>
        )}
        {memorySurface && <ArtifactMemoryDialog surface={memorySurface} onClose={() => setMemoryOf(undefined)} />}
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
