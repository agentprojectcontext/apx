import type { EngineStatus } from "@apx/protocol";
import { Icons, NavItem, ProjectTile, SectionLabel } from "@apx/ui";
import { type ReactNode, useMemo } from "react";
import { inProject, isWorking, projectEntries, projectInitial, projectTone } from "../data/identity.ts";
import { useData } from "../data/state.ts";
import { AccountRow } from "./AccountRow.tsx";
import { go, useNav } from "./nav.ts";

const CHANNELS = [
  { id: "whatsapp", name: "WhatsApp", tone: "brand", icon: <Icons.MessageCircle /> },
  { id: "telegram", name: "Telegram", tone: "info", icon: <Icons.Send /> },
] as const;

const RUNTIMES = [
  { id: "claude", name: "Claude Code", icon: <Icons.Code /> },
  { id: "codex", name: "Codex", icon: <Icons.Terminal /> },
] as const;

/** Inbox · Tareas · Canales · Proyectos · Sesiones externas · Apps · Recursos · Config · account. `rail` = 60px icons. */
export function Sidebar({ rail }: { rail: boolean }) {
  const view = useNav((s) => s.view);
  const projectId = useNav((s) => s.projectId);
  const appId = useNav((s) => s.appId);
  const configOpen = useNav((s) => s.config != null);
  const projects = useData((s) => s.projects);
  const threads = useData((s) => s.threads);
  const surfaces = useData((s) => s.surfaces);
  const engines = useData((s) => s.engines);

  const entries = useMemo(() => projectEntries(projects), [projects]);
  const stats = useMemo(() => {
    let unread = 0;
    const live = Object.values(threads).filter((t) => !t.parent_id && t.kind !== "a2a");
    for (const t of live) unread += t.unread;
    const running = new Set(
      entries.filter((p) => live.some((t) => inProject(t, p.id) && isWorking(t.state))).map((p) => p.id),
    );
    return { unread, running };
  }, [threads, entries]);
  const apps = useMemo(() => Object.values(surfaces).filter((s) => s.app), [surfaces]);

  return (
    <aside className={rail ? "sidebar is-rail" : "sidebar"} aria-label="Navegación">
      <div className="sidebar__scroll">
        <NavItem
          collapsed={rail}
          icon={<Icons.Inbox />}
          label="Inbox"
          count={stats.unread}
          active={view === "inbox"}
          onClick={() => go.inbox()}
        />
        <NavItem
          collapsed={rail}
          icon={<Icons.ListChecks />}
          label="Tareas"
          active={view === "tasks"}
          onClick={() => go.view("tasks")}
        />

        <Section rail={rail} title="Canales" />
        {CHANNELS.map((c) => (
          <NavItem
            key={c.id}
            collapsed={rail}
            disabled
            icon={<ProjectTile tone={c.tone} icon={c.icon} />}
            label={c.name}
            trailing={<span className="sidebar__soon">pronto</span>}
          />
        ))}

        <Section
          rail={rail}
          title="Proyectos"
          action={
            <button type="button" className="sidebar__add" aria-label="Nuevo proyecto (pronto)" title="Pronto" disabled>
              <Icons.Plus size={14} />
            </button>
          }
        />
        {entries.map((p) => (
          <NavItem
            key={p.id}
            collapsed={rail}
            icon={<ProjectTile tone={projectTone(p.id)} initial={projectInitial(p.name)} />}
            label={p.name}
            trailing={
              <>
                {p.isDefault && <Icons.Lock size={12} aria-label="Proyecto base" />}
                {stats.running.has(p.id) && <span className="sidebar__running" title="En curso" />}
              </>
            }
            active={view === "project" && projectId === p.id}
            onClick={() => go.project(p.id)}
          />
        ))}

        <Section rail={rail} title="Sesiones externas" />
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
            <Section rail={rail} title="Apps" />
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
          label="Recursos"
          active={view === "resources"}
          onClick={() => go.view("resources")}
        />
        <NavItem
          collapsed={rail}
          icon={<Icons.Settings />}
          label="Config"
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

/** Logged in → green dot; installed without a session → hint; missing → "instalar"; unknown → nothing. */
function EngineState({ engine }: { engine: EngineStatus | undefined }) {
  if (!engine) return null;
  if (engine.installed && engine.logged_in) return <span className="sidebar__running" title="Sesión iniciada" />;
  return <span className="sidebar__soon">{engine.installed ? "sin sesión" : "instalar"}</span>;
}
