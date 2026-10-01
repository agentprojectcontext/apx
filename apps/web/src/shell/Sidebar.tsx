import { AgentAvatar, Button, Dialog, Icons, NavItem, SectionLabel } from "@apx/ui";
import { useMemo, useState } from "react";
import { blobOf, isWorking } from "../data/identity.ts";
import { useData } from "../data/state.ts";
import { go, useNav } from "./nav.ts";

/** Inbox · Proyectos · Apps · Config. `rail` = icon-only 60px column. */
export function Sidebar({ rail }: { rail: boolean }) {
  const view = useNav((s) => s.view);
  const projectId = useNav((s) => s.projectId);
  const appId = useNav((s) => s.appId);
  const projects = useData((s) => s.projects);
  const threads = useData((s) => s.threads);
  const surfaces = useData((s) => s.surfaces);
  const [configOpen, setConfigOpen] = useState(false);

  const stats = useMemo(() => {
    const byProject = new Map<string, { unread: number; running: boolean }>();
    let unread = 0;
    for (const t of Object.values(threads)) {
      if (t.parent_id || t.kind === "a2a") continue;
      unread += t.unread;
      if (!t.project_id) continue;
      const s = byProject.get(t.project_id) ?? { unread: 0, running: false };
      s.unread += t.unread;
      s.running ||= isWorking(t.state);
      byProject.set(t.project_id, s);
    }
    return { unread, byProject };
  }, [threads]);
  const apps = useMemo(() => Object.values(surfaces).filter((s) => s.app), [surfaces]);

  return (
    <aside className={rail ? "sidebar is-rail" : "sidebar"} aria-label="Navegación">
      <NavItem
        collapsed={rail}
        icon={<Icons.Inbox />}
        label="Inbox"
        count={stats.unread}
        active={view === "inbox" && !projectId}
        onClick={() => go.inbox()}
      />
      <hr className="sidebar__divider" />
      {!rail && <SectionLabel>Proyectos</SectionLabel>}
      {projects.map((p) => {
        const st = stats.byProject.get(p.id);
        return (
          <NavItem
            key={p.id}
            collapsed={rail}
            icon={<AgentAvatar name={p.name} blob={blobOf(p)} size={20} animated={false} />}
            label={p.name}
            count={st?.unread}
            trailing={st?.running ? <span className="sidebar__running" title="En curso" /> : undefined}
            active={view === "inbox" && projectId === p.id}
            onClick={() => go.inbox(p.id)}
          />
        );
      })}
      {apps.length > 0 && (
        <>
          <hr className="sidebar__divider" />
          {!rail && <SectionLabel>Apps</SectionLabel>}
          {apps.map((a) => (
            <NavItem
              key={a.id}
              collapsed={rail}
              icon={
                <span className="sidebar__apptile">
                  <Icons.LayoutGrid size={12} />
                </span>
              }
              label={a.title}
              active={view === "app" && appId === a.id}
              onClick={() => go.app(a.id)}
            />
          ))}
        </>
      )}
      <span className="sidebar__spacer" />
      <NavItem collapsed={rail} icon={<Icons.Settings />} label="Config" onClick={() => setConfigOpen(true)} />
      <Dialog
        open={configOpen}
        onOpenChange={setConfigOpen}
        title="Configuración"
        description="Motores, canales, apariencia y memoria llegan en la próxima tanda."
        size="sm"
        footer={
          <Button variant="secondary" onClick={() => setConfigOpen(false)}>
            Cerrar
          </Button>
        }
      />
    </aside>
  );
}
