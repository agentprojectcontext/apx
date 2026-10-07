import { EmptyState, IconButton, Icons, PickRow, ResizeHandle, SegmentedControl, Tag } from "@apx/ui";
import { useMemo, useState } from "react";
import { shortWhen } from "../../common/format.ts";
import { inProject, type ProjectEntry } from "../../data/identity.ts";
import { useData } from "../../data/state.ts";
import { useT } from "../../i18n/index.ts";
import { SurfaceActions } from "../../surfaces/SurfaceActions.tsx";
import { SurfaceFrame } from "../../surfaces/SurfaceFrame.tsx";
import { FilesPane, NoFolder } from "./FilesPane.tsx";
import { GitPane } from "./GitPane.tsx";

type Scope = "folder" | "widgets" | "git";

/**
 * A project's files: its folder (the base project's is APX's work folder, where its chats work) or every widget its
 * chats made, so one that was never pinned is not lost.
 */
export function ProjectFiles({ project }: { project: ProjectEntry }) {
  const t = useT();
  const [scope, setScope] = useState<Scope>("folder");
  return (
    <div className="chatfiles">
      <div className="chatfiles__bar chatfiles__bar--project">
        <SegmentedControl
          size="sm"
          label={t("files.scope")}
          value={scope}
          onValueChange={(v) => setScope(v as Scope)}
          options={[
            { value: "folder", label: t("files.scope.folder") },
            { value: "widgets", label: t("files.scope.widgets") },
            // The base project's folder is APX's own, never a repository.
            ...(project.path ? [{ value: "git", label: t("files.scope.git") }] : []),
          ]}
        />
      </div>
      {scope === "git" ? (
        <GitPane key={project.id} projectId={project.id} />
      ) : scope === "widgets" ? (
        <ProjectWidgets projectId={project.id} />
      ) : project.isDefault ? (
        <FilesPane key="base" where={{ base: true }} label={t("files.workFolder")} />
      ) : project.path ? (
        <FilesPane key={project.id} where={{ project: project.id }} root={project.path} />
      ) : (
        <NoFolder />
      )}
    </div>
  );
}

/** The side panel's width limits and default (px). */
const PANEL = { min: 320, max: 960, initial: 520 } as const;

/**
 * Every widget of the project by name, newest first; picking one opens it, live, in a side panel the owner can widen
 * by dragging its edge.
 */
function ProjectWidgets({ projectId }: { projectId: string }) {
  const t = useT();
  const surfaces = useData((s) => s.surfaces);
  const [openId, setOpenId] = useState<string>();
  const [width, setWidth] = useState<number>(PANEL.initial);
  const mine = useMemo(
    () =>
      Object.values(surfaces)
        .filter((s) => inProject(s, projectId))
        .sort((a, b) => b.updated_at.localeCompare(a.updated_at)),
    [surfaces, projectId],
  );
  const open = openId ? surfaces[openId] : undefined;
  if (!mine.length)
    return (
      <div className="files files--empty">
        <EmptyState variant="dashed" size="lg" icon={<Icons.LayoutGrid />} title={t("files.noWidgets")}>
          {t("files.noWidgetsBody")}
        </EmptyState>
      </div>
    );
  return (
    <div className="projwidgets">
      <ul className="projwidgets__list" aria-label={t("files.scope.widgets")}>
        {mine.map((s) => (
          <li key={s.id}>
            <PickRow
              leading={<Icons.LayoutGrid size={16} />}
              title={s.title}
              description={`${s.name} · ${shortWhen(s.updated_at)}`}
              trailing={s.pinned ? <Tag>{t("files.onBoard")}</Tag> : undefined}
              selected={s.id === openId}
              onClick={() => setOpenId(s.id === openId ? undefined : s.id)}
            />
          </li>
        ))}
      </ul>
      {open && (
        <aside className="projwidgets__panel" style={{ width }} aria-label={open.title}>
          <ResizeHandle
            edge="left"
            width={width}
            min={PANEL.min}
            max={PANEL.max}
            onResize={setWidth}
            onReset={() => setWidth(PANEL.initial)}
            label={t("panel.resize")}
          />
          <header className="widgets__head projwidgets__head">
            <span className="widgets__title">{open.title}</span>
            <SurfaceActions surface={open} />
            <IconButton
              size="sm"
              label={t("common.close")}
              icon={<Icons.X size={14} />}
              onClick={() => setOpenId(undefined)}
            />
          </header>
          <div className="projwidgets__frame">
            <SurfaceFrame key={open.id} surfaceId={open.id} fit="fill" />
          </div>
        </aside>
      )}
    </div>
  );
}
