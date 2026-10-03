import type { ChannelInfo, EngineStatus } from "@apx/protocol";
import { EngineIcon, Icons, Menu, NavItem, ProjectTile, ResizeHandle, SectionLabel } from "@apx/ui";
import { type ReactNode, useEffect, useMemo } from "react";
import { addChannelItems, KindTile } from "../channels/KindIcon.tsx";
import { CHANNEL_KIND_IDS, CHANNEL_KINDS, isChannelKind } from "../channels/kinds.ts";
import { loadChannels, useChannels } from "../data/channels.ts";
import { isListed } from "../data/identity.ts";
import { setPrefs } from "../data/prefs.ts";
import { useData } from "../data/state.ts";
import { useT } from "../i18n/index.ts";
import { AccountRow } from "./AccountRow.tsx";
import { LAYOUT } from "./layout.ts";
import { go, useNav } from "./nav.ts";
import { ProjectsNav } from "./ProjectsNav.tsx";

/** "+" next to Channels: the kinds not connected yet (the ones still coming are shown, disabled). */
function AddChannel({ connected }: { connected: readonly ChannelInfo[] }) {
  const t = useT();
  const missing = CHANNEL_KIND_IDS.filter((k) => !connected.some((c) => c.type === k));
  if (!missing.length) return null;
  return (
    <Menu
      align="start"
      trigger={
        <button type="button" className="sidebar__add" aria-label={t("channels.add")} title={t("channels.add")}>
          <Icons.Plus size={14} />
        </button>
      }
      items={addChannelItems(
        connected.map((c) => c.type),
        t,
        go.channelConfig,
      )}
    />
  );
}

/** Inbox · Tasks (pinned) · Channels · Projects · External sessions · Apps · Resources · Settings · account. `rail` = 60px icons. */
export function Sidebar({ rail, width }: { rail: boolean; width: number }) {
  const t = useT();
  const view = useNav((s) => s.view);
  const appId = useNav((s) => s.appId);
  const configOpen = useNav((s) => s.config != null);
  const threads = useData((s) => s.threads);
  const surfaces = useData((s) => s.surfaces);
  const engines = useData((s) => s.engines);
  const channels = useChannels((s) => s.channels);
  const channelId = useNav((s) => s.channelId);
  const engineId = useNav((s) => s.engineId);
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
        <Section rail={rail} title={t("nav.channels")} action={<AddChannel connected={channels} />} />
        {channels.map((live) => {
          const kind = isChannelKind(live.type) ? live.type : undefined;
          const count = Object.values(threads).reduce((n, th) => n + (th.channel?.id === live.id ? th.unread : 0), 0);
          return (
            <NavItem
              key={live.id}
              collapsed={rail}
              icon={kind ? <KindTile kind={kind} /> : undefined}
              label={live.label ?? (kind ? t(CHANNEL_KINDS[kind].name) : live.id)}
              count={count}
              active={view === "channel" && channelId === live.id}
              onClick={() => go.channel(live.id)}
            />
          );
        })}

        <ProjectsNav rail={rail} />

        <Section rail={rail} title={t("nav.externalSessions")} />
        {/* Every engine the core found on this machine besides our own loop: Claude Code, Codex, ACP agents. */}
        {engines
          .filter((e) => e.id !== "native" && e.installed)
          .map((e) => (
            <NavItem
              key={e.id}
              collapsed={rail}
              icon={<EngineIcon engine={e.id} tile size={20} />}
              label={e.label}
              trailing={<EngineState engine={e} />}
              active={view === "engine" && engineId === e.id}
              onClick={() => go.engine(e.id)}
            />
          ))}

        {apps.length > 0 && (
          <>
            <Section rail={rail} title={t("nav.apps")} />
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

function Section({ rail, title, action }: { rail: boolean; title: string; action?: ReactNode }) {
  return (
    <>
      <hr className="sidebar__divider" />
      {rail ? (
        action && <div className="sidebar__railaction">{action}</div>
      ) : (
        <SectionLabel action={action}>{title}</SectionLabel>
      )}
    </>
  );
}

/** Logged in → green dot; installed without a session → hint; missing → "install"; unknown → nothing. */
function EngineState({ engine }: { engine: EngineStatus | undefined }) {
  const t = useT();
  if (!engine) return null;
  if (engine.installed && engine.logged_in) return <span className="sidebar__running" title={t("engine.loggedIn")} />;
  return <span className="sidebar__soon">{engine.installed ? t("engine.noSession") : t("engine.install")}</span>;
}
