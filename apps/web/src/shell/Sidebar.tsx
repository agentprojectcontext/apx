import { Icons, NavItem, ProjectTile, ResizeHandle } from "@apx/ui";
import { useEffect, useMemo } from "react";
import { loadChannels } from "../data/channels.ts";
import { isListed } from "../data/identity.ts";
import { setPrefs } from "../data/prefs.ts";
import { useData } from "../data/state.ts";
import { useT } from "../i18n/index.ts";
import { AccountRow } from "./AccountRow.tsx";
import { ChannelsNav } from "./ChannelsNav.tsx";
import { ExternalSessionsNav } from "./ExternalSessionsNav.tsx";
import { LAYOUT } from "./layout.ts";
import { go, useNav } from "./nav.ts";
import { ProjectsNav } from "./ProjectsNav.tsx";
import { SidebarSection } from "./SidebarSection.tsx";

/** Inbox · Tasks (pinned) · Channels · Projects · External sessions · Apps · Resources · Settings · account. `rail` = 60px icons. */
export function Sidebar({ rail, width }: { rail: boolean; width: number }) {
  const t = useT();
  const view = useNav((s) => s.view);
  const appId = useNav((s) => s.appId);
  const configOpen = useNav((s) => s.config != null);
  const threads = useData((s) => s.threads);
  const surfaces = useData((s) => s.surfaces);
  useEffect(() => {
    void loadChannels();
  }, []);

  const unread = useMemo(() => {
    let n = 0;
    for (const t of Object.values(threads)) if (isListed(t)) n += t.unread;
    return n;
  }, [threads]);
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
      <div className="sidebar__foot">
        <NavItem
          collapsed={rail}
          icon={<Icons.Layers />}
          label={t("nav.resources")}
          active={view === "resources"}
          onClick={() => go.view("resources")}
        />
        <NavItem
          collapsed={rail}
          icon={<Icons.Settings />}
          label={t("nav.config")}
          active={configOpen}
          onClick={() => go.config()}
        />
        <AccountRow rail={rail} />
      </div>
    </aside>
  );
}
