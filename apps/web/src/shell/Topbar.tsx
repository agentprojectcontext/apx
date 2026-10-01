import { AgentAvatar, IconButton, Icons, Kbd, Menu } from "@apx/ui";
import { Fragment } from "react";
import logoUrl from "../assets/logo.png";
import { blobOf, findProject, projectName, secretary } from "../data/identity.ts";
import { useData } from "../data/state.ts";
import { go, PROJECT_TABS, useNav } from "./nav.ts";
import { RunningIndicator } from "./RunningIndicator.tsx";

/** SPEC §1.5: Inbox / project / chat · Proyectos / project / tab · Apps / app · Tareas · Recursos. */
function useCrumbs(): string[] {
  const view = useNav((s) => s.view);
  const projectId = useNav((s) => s.projectId);
  const projectTab = useNav((s) => s.projectTab);
  const threadId = useNav((s) => s.threadId);
  const appId = useNav((s) => s.appId);
  const projects = useData((s) => s.projects);
  const thread = useData((s) => (threadId ? s.threads[threadId] : undefined));
  const app = useData((s) => (appId ? s.surfaces[appId] : undefined));
  if (view === "app") return ["Apps", app?.title ?? "App"];
  if (view === "tasks") return ["Tareas"];
  if (view === "resources") return ["Recursos"];
  if (view === "project") {
    const tab = PROJECT_TABS.find((t) => t.id === projectTab)?.label ?? "Resumen";
    return ["Proyectos", findProject(projects, projectId)?.name ?? "Proyecto", tab];
  }
  return thread ? ["Inbox", projectName(projects, thread.project_id), thread.title] : ["Inbox"];
}

export function Topbar() {
  const crumbs = useCrumbs();
  const mode = useNav((s) => s.mode);
  const agents = useData((s) => s.agents);
  const homeId = useData((s) => Object.values(s.threads).find((t) => t.kind === "home")?.id);
  const sec = secretary(agents);
  return (
    <header className="topbar">
      <img className="topbar__logo" src={logoUrl} alt="APX" width={22} height={22} />
      <nav className="topbar__crumbs" aria-label="Ubicación">
        {crumbs.map((c, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: breadcrumbs are positional
          <Fragment key={i}>
            {i > 0 && <span className="topbar__sep">/</span>}
            <span className={i === crumbs.length - 1 ? "topbar__crumb is-last" : "topbar__crumb"}>{c}</span>
          </Fragment>
        ))}
      </nav>
      <span className="topbar__spacer" />
      <button type="button" className="topbar__search" title="Búsqueda: próximamente" disabled>
        <Icons.Search size={14} />
        <span className="topbar__search-label">Buscar o saltar a…</span>
        <Kbd keys={["⌘", "K"]} />
      </button>
      <span className="topbar__spacer" />
      <RunningIndicator />
      <IconButton
        label="Abrir en el teléfono"
        icon={<Icons.Smartphone size={16} />}
        className="topbar__icon"
        onClick={() => go.phone(true)}
      />
      <Menu
        align="end"
        items={[
          { type: "label", label: "Idioma" },
          { label: "Español", icon: <Icons.Check />, onSelect: () => {} },
          { label: "English", icon: <span />, shortcut: "pronto", disabled: true },
        ]}
        trigger={
          <button type="button" className="topbar__lang" aria-label="Idioma: español">
            <Icons.Languages size={16} />
            ES
          </button>
        }
      />
      <IconButton
        label={mode === "dark" ? "Modo claro" : "Modo oscuro"}
        icon={mode === "dark" ? <Icons.Sun size={16} /> : <Icons.Moon size={16} />}
        className="topbar__icon"
        onClick={go.toggleMode}
      />
      {sec && (
        <button
          type="button"
          className="topbar__agent"
          title={`Chat con ${sec.name} (⌘J)`}
          onClick={() => homeId && go.inboxThread(homeId)}
          disabled={!homeId}
        >
          <AgentAvatar name={sec.name} blob={blobOf(sec)} size={24} />
          <span>{sec.name}</span>
          <span className="topbar__agentkbd">⌘J</span>
        </button>
      )}
    </header>
  );
}
