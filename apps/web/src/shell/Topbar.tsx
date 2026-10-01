import { IconButton, Icons, Kbd } from "@apx/ui";
import { Fragment } from "react";
import { projectName } from "../data/identity.ts";
import { useData } from "../data/state.ts";
import { go, useNav } from "./nav.ts";
import { RunningIndicator } from "./RunningIndicator.tsx";

function useCrumbs(): string[] {
  const view = useNav((s) => s.view);
  const projectId = useNav((s) => s.projectId);
  const threadId = useNav((s) => s.threadId);
  const appId = useNav((s) => s.appId);
  const projects = useData((s) => s.projects);
  const thread = useData((s) => (threadId ? s.threads[threadId] : undefined));
  const app = useData((s) => (appId ? s.surfaces[appId] : undefined));
  if (view === "app") return ["Apps", app?.title ?? "App"];
  const crumbs = ["Inbox"];
  const pid = thread ? thread.project_id : projectId;
  if (thread || projectId) crumbs.push(projectName(projects, pid));
  if (thread) crumbs.push(thread.title);
  return crumbs;
}

export function Topbar() {
  const crumbs = useCrumbs();
  const mode = useNav((s) => s.mode);
  return (
    <header className="topbar">
      <span className="topbar__logo" aria-hidden="true">
        apx
      </span>
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
        label={mode === "dark" ? "Modo claro" : "Modo oscuro"}
        icon={mode === "dark" ? <Icons.Sun size={16} /> : <Icons.Moon size={16} />}
        onClick={go.toggleMode}
      />
    </header>
  );
}
