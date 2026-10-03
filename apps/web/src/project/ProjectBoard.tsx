import { EmptyState, IconButton, Icons } from "@apx/ui";
import { useMemo } from "react";
import { setSurfaceFlags } from "../data/actions.ts";
import { inProject } from "../data/identity.ts";
import { useData } from "../data/state.ts";
import { useT } from "../i18n/index.ts";
import { go } from "../shell/nav.ts";
import { ShareMenu } from "../surfaces/ShareMenu.tsx";
import { SurfaceFrame } from "../surfaces/SurfaceFrame.tsx";

/**
 * The project's board: the widgets pinned to it, live. Agents keep them current by name ("update monthly-sales with
 * September"), so opening a project shows how it is doing, not an empty chat.
 */
export function ProjectBoard({ projectId }: { projectId: string }) {
  const t = useT();
  const surfaces = useData((s) => s.surfaces);
  const pinned = useMemo(
    () =>
      Object.values(surfaces)
        .filter((s) => s.pinned && inProject(s, projectId))
        // By name: a widget an agent updates stays where it is.
        .sort((a, b) => a.name.localeCompare(b.name)),
    [surfaces, projectId],
  );
  return (
    <section className="overview__block board" aria-label={t("board.title")}>
      <h2 className="overview__h">{t("board.title")}</h2>
      {!pinned.length ? (
        <EmptyState variant="dashed" icon={<Icons.LayoutGrid />}>
          {t("board.empty")}
        </EmptyState>
      ) : (
        <div className="board__grid">
          {pinned.map((s) => (
            <article key={s.id} className="board__tile" aria-label={s.title}>
              <header className="widgets__head">
                <span className="widgets__title">{s.title}</span>
                <ShareMenu surface={s} variant="icon" />
                {s.app && (
                  <IconButton
                    size="sm"
                    label={t("widget.openApp")}
                    icon={<Icons.AppWindow size={14} />}
                    onClick={() => go.app(s.id)}
                  />
                )}
                <IconButton
                  size="sm"
                  label={t("board.unpin")}
                  icon={<Icons.PinOff size={14} />}
                  onClick={() => void setSurfaceFlags(s.id, { pinned: false })}
                />
              </header>
              <SurfaceFrame surfaceId={s.id} />
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
