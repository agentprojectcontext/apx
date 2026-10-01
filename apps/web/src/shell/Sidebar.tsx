import type { EngineStatus } from "@apx/protocol";
import { Icons, NavItem, ProjectTile, SectionLabel } from "@apx/ui";
import { type ReactNode, useMemo } from "react";
import { useData } from "../data/state.ts";
import { useT } from "../i18n/index.ts";
import { AccountRow } from "./AccountRow.tsx";
import { go, useNav } from "./nav.ts";
import { ProjectsNav } from "./ProjectsNav.tsx";

const CHANNELS = [
  { id: "whatsapp", name: "WhatsApp", tone: "brand", icon: <Icons.MessageCircle /> },
  { id: "telegram", name: "Telegram", tone: "info", icon: <Icons.Send /> },
] as const;

const RUNTIMES = [
  { id: "claude", name: "Claude Code", icon: <Icons.Code /> },
  { id: "codex", name: "Codex", icon: <Icons.Terminal /> },
] as const;

/** Inbox · Tasks (pinned) · Channels · Projects · External sessions · Apps · Resources · Settings · account. `rail` = 60px icons. */
export function Sidebar({ rail }: { rail: boolean }) {
  const t = useT();
  const view = useNav((s) => s.view);
  const appId = useNav((s) => s.appId);
  const configOpen = useNav((s) => s.config != null);
  const threads = useData((s) => s.threads);
  const surfaces = useData((s) => s.surfaces);
  const engines = useData((s) => s.engines);

  const unread = useMemo(() => {
    let n = 0;
    for (const t of Object.values(threads)) if (!t.parent_id && t.kind !== "a2a") n += t.unread;
    return n;
  }, [threads]);
  const apps = useMemo(() => Object.values(surfaces).filter((s) => s.app), [surfaces]);

  return (
    <aside className={rail ? "sidebar is-rail" : "sidebar"} aria-label={t("nav.label")}>
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
        <Section rail={rail} title={t("nav.channels")} />
        {CHANNELS.map((c) => (
          <NavItem
            key={c.id}
            collapsed={rail}
            disabled
            icon={<ProjectTile tone={c.tone} icon={c.icon} />}
            label={c.name}
            trailing={<span className="sidebar__soon">{t("common.soonLower")}</span>}
          />
        ))}

        <ProjectsNav rail={rail} />

        <Section rail={rail} title={t("nav.externalSessions")} />
        {RUNTIMES.map((r) => {
          const e = engines.find((x) => x.id === r.id);
          return (
            <NavItem
              key={r.id}
              collapsed={rail}
              icon={<ProjectTile tone="ink" shape="circle" icon={r.icon} />}
              label={e?.label ?? r.name}
              trailing={<EngineState engine={e} />}
              active={false}
              onClick={() => go.config("engines")}
            />
          );
        })}

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
