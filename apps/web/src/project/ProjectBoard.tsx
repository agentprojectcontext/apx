import type { SurfaceSummary } from "@apx/protocol";
import { EmptyState, IconButton, Icons, Menu } from "@apx/ui";
import { type DragEvent, useMemo, useState } from "react";
import { inProject } from "../data/identity.ts";
import { setBoard, usePrefs } from "../data/prefs.ts";
import { useData } from "../data/state.ts";
import { useT } from "../i18n/index.ts";
import { SurfaceActions } from "../surfaces/SurfaceActions.tsx";
import { SurfaceFrame } from "../surfaces/SurfaceFrame.tsx";
import { useBoardMenu } from "./boardMenu.tsx";

/** A tile's height (px) until the owner drags its bottom edge; its widget scrolls inside it. */
const TILE_H = 360;
const TILE_MIN_H = 140;
const TILE_MAX_H = 1600;
const NO_BOARD = { order: [] as string[], wide: false, heights: {} as Record<string, number> };

/** The owner's order first; widgets pinned since then follow by name, so one an agent updates stays where it is. */
function ordered(pinned: SurfaceSummary[], order: string[]): SurfaceSummary[] {
  const at = new Map(order.map((id, i) => [id, i]));
  return [...pinned].sort(
    (a, b) =>
      (at.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (at.get(b.id) ?? Number.MAX_SAFE_INTEGER) ||
      a.name.localeCompare(b.name),
  );
}

/**
 * The project's board: the widgets pinned to it, live. Agents keep them current by name ("update monthly-sales with
 * September"), so opening a project shows how it is doing. The owner orders them by dragging their title bars and
 * may give the board the whole width; both are remembered on this device.
 */
/** While a tile is resized, the frames stop taking the pointer (as while one is dragged). */
const RESIZING = "~resizing";

/** A tile's bottom edge: dragged (or moved with the arrow keys) to make the tile taller or shorter. */
function TileResize({
  height,
  label,
  onResize,
  onDragging,
}: {
  height: number;
  label: string;
  onResize(h: number): void;
  onDragging(on: boolean): void;
}) {
  const clamp = (h: number) => Math.min(TILE_MAX_H, Math.max(TILE_MIN_H, Math.round(h)));
  return (
    // biome-ignore lint/a11y/useSemanticElements: a horizontal splitter has no native element; this is the WAI-ARIA one.
    <div
      role="separator"
      aria-orientation="horizontal"
      aria-label={label}
      aria-valuenow={height}
      aria-valuemin={TILE_MIN_H}
      aria-valuemax={TILE_MAX_H}
      tabIndex={0}
      className="projboard__resize"
      onPointerDown={(e) => {
        e.preventDefault();
        const start = e.clientY;
        const from = height;
        const el = e.currentTarget;
        el.setPointerCapture(e.pointerId);
        onDragging(true);
        const move = (ev: PointerEvent) => onResize(clamp(from + ev.clientY - start));
        const up = () => {
          el.removeEventListener("pointermove", move);
          el.removeEventListener("pointerup", up);
          onDragging(false);
        };
        el.addEventListener("pointermove", move);
        el.addEventListener("pointerup", up);
      }}
      onKeyDown={(e) => {
        const by = { ArrowUp: -24, ArrowDown: 24 }[e.key];
        if (!by) return;
        e.preventDefault();
        onResize(clamp(height + by));
      }}
      onDoubleClick={() => onResize(TILE_H)}
    />
  );
}

export function ProjectBoard({ projectId }: { projectId: string }) {
  const t = useT();
  const surfaces = useData((s) => s.surfaces);
  const board = usePrefs((p) => p.boards[projectId]) ?? NO_BOARD;
  const [dragging, setDragging] = useState<string>();
  const [over, setOver] = useState<string>();
  const mine = useMemo(
    () =>
      Object.values(surfaces)
        .filter((s) => inProject(s, projectId))
        .sort((a, b) => a.title.localeCompare(b.title)),
    [surfaces, projectId],
  );
  const tiles = useMemo(
    () =>
      ordered(
        mine.filter((s) => s.pinned),
        board.order,
      ),
    [mine, board.order],
  );

  const choices = useBoardMenu(projectId, mine);

  /** Puts the dragged tile where the target is, and remembers the whole order. */
  const drop = (target: string) => {
    const from = dragging;
    setDragging(undefined);
    setOver(undefined);
    if (!from || from === target || from === RESIZING) return;
    const ids = tiles.map((s) => s.id).filter((id) => id !== from);
    const to = ids.indexOf(target);
    // Dropped on a tile further on, it goes after it; on one before, it takes its place.
    const after = tiles.findIndex((s) => s.id === from) < tiles.findIndex((s) => s.id === target);
    ids.splice(to + (after ? 1 : 0), 0, from);
    setBoard(projectId, { order: ids });
  };
  /** The grip's keyboard way to move a tile one place (the drag is the pointer's). */
  const nudge = (id: string, by: -1 | 1) => {
    const ids = tiles.map((s) => s.id);
    const i = ids.indexOf(id);
    const j = i + by;
    if (i < 0 || j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j] as string, ids[i] as string];
    setBoard(projectId, { order: ids });
  };
  const allowDrop = (id: string) => (e: DragEvent) => {
    if (!dragging) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (over !== id) setOver(id);
  };

  return (
    <section className={`overview__block projboard${board.wide ? " is-wide" : ""}`} aria-label={t("board.title")}>
      <div className="projboard__bar">
        <h2 className="overview__h">{t("board.title")}</h2>
        <span className="files__spacer" />
        <IconButton
          size="sm"
          label={board.wide ? t("board.narrow") : t("board.wide")}
          icon={board.wide ? <Icons.Minimize2 size={14} /> : <Icons.Maximize2 size={14} />}
          active={board.wide}
          onClick={() => setBoard(projectId, { wide: !board.wide })}
        />
        <Menu
          align="end"
          trigger={<IconButton size="sm" label={t("board.add")} icon={<Icons.Plus size={14} />} />}
          items={choices}
        />
      </div>
      {!tiles.length ? (
        <EmptyState variant="dashed" icon={<Icons.LayoutGrid />}>
          {t("board.empty")}
        </EmptyState>
      ) : (
        <div className={`projboard__grid${dragging ? " is-dragging" : ""}`}>
          {tiles.map((s) => (
            <article
              key={s.id}
              className={`projboard__tile${dragging === s.id ? " is-dragged" : ""}${over === s.id && dragging !== s.id ? " is-over" : ""}`}
              aria-label={s.title}
              onDragOver={allowDrop(s.id)}
              onDragLeave={() => over === s.id && setOver(undefined)}
              onDrop={(e) => {
                e.preventDefault();
                drop(s.id);
              }}
            >
              {/* biome-ignore lint/a11y/noStaticElementInteractions: dragging is the pointer's shortcut; the grip button moves the tile with the keyboard. */}
              <header
                className="widgets__head projboard__head"
                draggable
                title={t("board.drag")}
                onDragStart={(e) => {
                  e.dataTransfer.effectAllowed = "move";
                  e.dataTransfer.setData("text/plain", s.id);
                  setDragging(s.id);
                }}
                onDragEnd={() => {
                  setDragging(undefined);
                  setOver(undefined);
                }}
              >
                <button
                  type="button"
                  className="projboard__grip"
                  aria-label={t("board.move", { name: s.title })}
                  onKeyDown={(e) => {
                    const by = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 }[e.key];
                    if (!by) return;
                    e.preventDefault();
                    nudge(s.id, by as -1 | 1);
                  }}
                >
                  <Icons.GripVertical size={14} />
                </button>
                <span className="widgets__title">{s.title}</span>
                <SurfaceActions surface={s} />
              </header>
              <div className="projboard__frame" style={{ height: board.heights[s.id] ?? TILE_H }}>
                <SurfaceFrame surfaceId={s.id} fit="fill" />
              </div>
              <TileResize
                height={board.heights[s.id] ?? TILE_H}
                label={t("board.resize", { name: s.title })}
                onDragging={(on) => setDragging(on ? RESIZING : undefined)}
                onResize={(h) => setBoard(projectId, { heights: { ...board.heights, [s.id]: h } })}
              />
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
