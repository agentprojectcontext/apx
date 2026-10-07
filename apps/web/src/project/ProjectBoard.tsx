import { EmptyState, IconButton, Icons, Menu, type MenuEntry } from "@apx/ui";
import { useMemo } from "react";
import { setSurfaceFlags } from "../data/actions.ts";
import { inProject } from "../data/identity.ts";
import { useData } from "../data/state.ts";
import { useT } from "../i18n/index.ts";
import { SurfaceActions } from "../surfaces/SurfaceActions.tsx";
import { SurfaceFrame } from "../surfaces/SurfaceFrame.tsx";

/**
 * The project's board: the widgets pinned to it, live. Agents keep them current by name ("update monthly-sales with
 * September"), so opening a project shows how it is doing, not an empty chat.
 */
export function ProjectBoard({ projectId }: { projectId: string }) {
  const t = useT();
  const surfaces = useData((s) => s.surfaces);
  const mine = useMemo(
    () =>
      Object.values(surfaces)
        .filter((s) => inProject(s, projectId))
        // By name: a widget an agent updates stays where it is.
        .sort((a, b) => a.name.localeCompare(b.name)),
    [surfaces, projectId],
  );
  const pinned = mine.filter((s) => s.pinned);
  // One already on the board shows checked and cannot be added again; taking it off is the tile's own pin.
  const choices: MenuEntry[] = mine.length
    ? mine.map((s) => ({
        label: s.title,
        icon: <Icons.LayoutGrid />,
        checked: s.pinned,
        disabled: s.pinned,
        onSelect: () => void setSurfaceFlags(s.id, { pinned: true }),
      }))
    : [{ label: t("board.none"), disabled: true }];
  return (
    <section className="overview__block board" aria-label={t("board.title")}>
      <div className="board__bar">
        <h2 className="overview__h">{t("board.title")}</h2>
        <Menu
          trigger={<IconButton size="sm" label={t("board.add")} icon={<Icons.Plus size={14} />} />}
          items={choices}
        />
      </div>
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
                <SurfaceActions surface={s} />
              </header>
              <SurfaceFrame surfaceId={s.id} />
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
