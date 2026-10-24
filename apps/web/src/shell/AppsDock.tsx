import type { SurfaceSummary } from "@apx/protocol";
import { ContextMenu, IconButton, Icons, NavItem, Popover, ProjectTile, SearchField } from "@apx/ui";
import { useMemo, useState } from "react";
import { setSurfaceFlags } from "../data/actions.ts";
import { projectName } from "../data/identity.ts";
import { useData } from "../data/state.ts";
import { useT } from "../i18n/index.ts";
import { ArtifactMemoryDialog } from "../surfaces/ArtifactMemory.tsx";
import { ArtifactPropertiesDialog } from "../surfaces/ArtifactProperties.tsx";
import { artifactMenu } from "../surfaces/artifactMenu.tsx";
import { openInstall } from "../surfaces/installRequest.ts";
import { dropLive, useRunningApps } from "../surfaces/livePool.ts";
import { createArtifact } from "../surfaces/widgetChatActions.ts";
import { go, useNav } from "./nav.ts";
import { SidebarSection } from "./SidebarSection.tsx";
import "../styles/artifacts.css";

/** Folds accents and case, so "estadisticas" finds "Estadísticas". */
const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/**
 * Apps in the sidebar, like a dock: every app (an artifact listed in Apps), a dot on each one still running, then under
 * a line the artifacts opened but not pinned, each with its pin, until closed. "+" opens any artifact in the system.
 */
export function AppsDock({ rail }: { rail: boolean }) {
  const t = useT();
  const surfaces = useData((s) => s.surfaces);
  const view = useNav((s) => s.view);
  const appId = useNav((s) => s.appId);
  const runningIds = useRunningApps();
  const running = useMemo(() => new Set(runningIds), [runningIds]);
  const [memoryOf, setMemoryOf] = useState<string>();
  const [propsOf, setPropsOf] = useState<string>();
  // Newest first: one just installed or changed shows on top.
  const pinned = useMemo(
    () =>
      Object.values(surfaces)
        .filter((s) => s.app)
        .sort((a, b) => b.updated_at.localeCompare(a.updated_at)),
    [surfaces],
  );
  // Opened and not in Apps: shown while they run, and the one on screen even when the pool could not keep it.
  const loose = useMemo(() => {
    const ids = [...runningIds];
    if (view === "app" && appId && !ids.includes(appId)) ids.push(appId);
    return ids.flatMap((id) => {
      const s = surfaces[id];
      return s && !s.app ? [s] : [];
    });
  }, [runningIds, surfaces, view, appId]);

  const item = (a: SurfaceSummary) => (
    <ContextMenu
      key={a.id}
      items={artifactMenu(a, t, {
        onMemory: () => setMemoryOf(a.id),
        onProperties: () => setPropsOf(a.id),
        running: running.has(a.id),
      })}
    >
      <NavItem
        collapsed={rail}
        icon={
          <span className="appsdock__icon">
            <ProjectTile tone="violet" icon={<Icons.LayoutGrid />} />
            {/* The rail hides trailing content, so there the dot sits on the icon. */}
            {rail && running.has(a.id) && <span className="navitem__running appsdock__dot" />}
          </span>
        }
        label={a.title}
        trailing={
          !rail && running.has(a.id) ? <span className="navitem__running" title={t("artifact.running")} /> : undefined
        }
        active={view === "app" && appId === a.id}
        onClick={() => go.app(a.id)}
      />
    </ContextMenu>
  );

  const memory = memoryOf ? surfaces[memoryOf] : undefined;
  const props = propsOf ? surfaces[propsOf] : undefined;
  return (
    <>
      <SidebarSection
        rail={rail}
        title={t("nav.apps")}
        action={
          <span className="appsdock__actions">
            <IconButton
              size="sm"
              className="sidebar__add"
              label={t("artifact.install")}
              icon={<Icons.Upload size={14} />}
              onClick={() => openInstall()}
            />
            <AppLauncher running={running} />
          </span>
        }
      />
      {pinned.map(item)}
      {loose.length > 0 && pinned.length > 0 && <hr className="appsdock__sep" />}
      {loose.map((a) => (
        <div key={a.id} className="appsdock__loose">
          {item(a)}
          {!rail && (
            <span className="appsdock__looseactions">
              <IconButton
                size="sm"
                label={t("widget.installApp")}
                icon={<Icons.Pin size={14} />}
                onClick={() => void setSurfaceFlags(a.id, { app: true })}
              />
              <IconButton
                size="sm"
                className="appsdock__close"
                label={t("artifact.closeApp")}
                icon={<Icons.X size={14} />}
                onClick={() => {
                  dropLive(a.id);
                  if (view === "app" && appId === a.id) go.inbox();
                }}
              />
            </span>
          )}
        </div>
      ))}
      {memory && <ArtifactMemoryDialog surface={memory} onClose={() => setMemoryOf(undefined)} />}
      {props && <ArtifactPropertiesDialog surface={props} onClose={() => setPropsOf(undefined)} />}
    </>
  );
}

/** Every artifact in the system, searchable: one click opens it (running, not pinned). */
function AppLauncher({ running }: { running: ReadonlySet<string> }) {
  const t = useT();
  const surfaces = useData((s) => s.surfaces);
  const projects = useData((s) => s.projects);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const all = useMemo(
    () =>
      Object.values(surfaces)
        .filter((s) => !q || fold(`${s.title} ${s.name}`).includes(fold(q)))
        .sort((a, b) => a.title.localeCompare(b.title)),
    [surfaces, q],
  );
  const launch = (s: SurfaceSummary) => {
    setOpen(false);
    setQ("");
    go.app(s.id);
  };
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      align="start"
      width={320}
      label={t("artifact.launcher")}
      trigger={
        <IconButton size="sm" className="sidebar__add" label={t("artifact.launcher")} icon={<Icons.Plus size={14} />} />
      }
    >
      <div className="appsdock__launcher">
        <button
          type="button"
          className="appsdock__row appsdock__create"
          onClick={() => {
            setOpen(false);
            createArtifact();
          }}
        >
          <Icons.Sparkles size={14} />
          <span className="appsdock__name">
            {t("artifact.create")}
            <small>{t("artifact.createHint")}</small>
          </span>
        </button>
        <SearchField
          size="sm"
          autoFocus
          value={q}
          placeholder={t("artifact.launcherSearch")}
          onChange={(e) => setQ(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && all[0]) launch(all[0]);
          }}
        />
        <div className="appsdock__list" role="listbox" aria-label={t("artifact.launcher")}>
          {all.length === 0 && <div className="appsdock__empty">{t("artifact.launcherEmpty")}</div>}
          {all.map((s) => (
            <button
              key={s.id}
              type="button"
              role="option"
              aria-selected={false}
              className="appsdock__row"
              data-pinned={s.app || undefined}
              onClick={() => launch(s)}
            >
              <Icons.LayoutGrid size={14} />
              <span className="appsdock__name">
                {s.title}
                <small>
                  {projectName(projects, s.project_id)} · {t(s.app ? "artifact.kindApp" : "artifact.kindWidget")}
                  {s.app ? ` · ${t("artifact.pinned")}` : ""}
                </small>
              </span>
              {running.has(s.id) && <span className="navitem__running" title={t("artifact.running")} />}
            </button>
          ))}
        </div>
      </div>
    </Popover>
  );
}
