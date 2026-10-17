import { Icons, NavItem, ProjectTile, ResizeHandle } from "@apx/ui";
import { lazy, Suspense, useEffect, useMemo } from "react";
import { loadChannels } from "../data/channels.ts";
import { inInbox } from "../data/identity.ts";
import { setPrefs, usePrefs } from "../data/prefs.ts";
import { useData } from "../data/state.ts";
import { useT } from "../i18n/index.ts";
import { AccountRow } from "./AccountRow.tsx";
import { ChannelsNav } from "./ChannelsNav.tsx";
import { ExternalSessionsNav } from "./ExternalSessionsNav.tsx";
import { LAYOUT } from "./layout.ts";
import { go, useNav } from "./nav.ts";
import { ProjectsNav } from "./ProjectsNav.tsx";
import { SidebarSection } from "./SidebarSection.tsx";

// Not needed for the first paint.
const CornerCards = lazy(() => import("./CornerCards.tsx").then((m) => ({ default: m.CornerCards })));

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
  const unread = useMemo(() => {
    let n = 0;
    for (const t of Object.values(threads)) if (inInbox(t, routines)) n += t.unread;
    return n;
  }, [threads, routines]);
  const apps = useMemo(() => Object.values(surfaces).filter((s) => s.app), [surfaces]);

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
        <NavItem
          collapsed={rail}
          icon={<Icons.Inbox />}
          label={t("nav.inbox")}
          count={unread}
          active={view === "inbox"}
          onClick={() => go.inbox()}
        />
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
            <SidebarSection rail={rail} title={t("nav.apps")} />
            {apps.map((a) => (
              <NavItem
                key={a.id}
                collapsed={rail}
                icon={<ProjectTile tone="violet" icon={<Icons.LayoutGrid />} />}
                label={a.title}
                active={view === "app" && appId === a.id}
                onClick={() => go.app(a.id)}
              />
            ))}
          </>
        )}
      </div>
      {!rail && (
        <Suspense fallback={null}>
          <CornerCards />
        </Suspense>
      )}
      <div className="sidebar__foot">
        <AccountRow rail={rail} />
      </div>
    </aside>
  );
}
