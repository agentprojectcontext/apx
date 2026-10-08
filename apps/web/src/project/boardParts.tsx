import { AgentAvatar, Button, Icons, Menu } from "@apx/ui";
import { type PointerEvent as ReactPointerEvent, useState } from "react";
import { blobOf } from "../data/identity.ts";
import { useT } from "../i18n/index.ts";
import type { BoardChoices } from "./boardMenu.tsx";

/** A tile's height (px) until the owner drags its bottom edge; its widget scrolls inside it. */
export const TILE_H = 360;
const TILE_MIN_H = 140;
const TILE_MAX_H = 1600;

/** Follows the pointer from a press until it is let go, reporting how far it moved. */
function track(
  e: ReactPointerEvent<HTMLElement>,
  onMove: (dx: number, dy: number) => void,
  onDragging: (on: boolean) => void,
) {
  e.preventDefault();
  const x = e.clientX;
  const y = e.clientY;
  const el = e.currentTarget;
  el.setPointerCapture(e.pointerId);
  onDragging(true);
  const move = (ev: PointerEvent) => onMove(ev.clientX - x, ev.clientY - y);
  const up = () => {
    el.removeEventListener("pointermove", move);
    el.removeEventListener("pointerup", up);
    onDragging(false);
  };
  el.addEventListener("pointermove", move);
  el.addEventListener("pointerup", up);
}

/** A tile's bottom edge: dragged (or moved with the arrow keys) to make the tile taller or shorter. */
export function TileHeight({
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
    // biome-ignore lint/a11y/useSemanticElements: a splitter has no native element; this is the WAI-ARIA one.
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
        const from = height;
        track(e, (_, dy) => onResize(clamp(from + dy)), onDragging);
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

/** The board grid's columns as laid out now: how many, and the distance from one to the next. */
export function gridColumns(grid: Element | null): { count: number; step: number } {
  if (!grid) return { count: 1, step: 0 };
  const style = getComputedStyle(grid);
  const cols = style.gridTemplateColumns.split(" ").filter(Boolean);
  return {
    count: Math.max(1, cols.length),
    step: (Number.parseFloat(cols[0] ?? "") || 0) + (Number.parseFloat(style.columnGap) || 0),
  };
}

/**
 * A tile's right edge: dragged (or moved with the arrow keys) to span more or fewer of the board's columns; the tiles
 * beside it move down or up to make room.
 */
export function TileWidth({
  span,
  max,
  label,
  onResize,
  onDragging,
}: {
  span: number;
  max: number;
  label: string;
  onResize(span: number): void;
  onDragging(on: boolean): void;
}) {
  const clamp = (n: number) => Math.min(max, Math.max(1, Math.round(n)));
  return (
    // biome-ignore lint/a11y/useSemanticElements: a splitter has no native element; this is the WAI-ARIA one.
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={span}
      aria-valuemin={1}
      aria-valuemax={max}
      tabIndex={0}
      className="projboard__widen"
      onPointerDown={(e) => {
        const { step } = gridColumns(e.currentTarget.closest(".projboard__grid"));
        const from = span;
        if (step > 0) track(e, (dx) => onResize(clamp(from + dx / step)), onDragging);
      }}
      onKeyDown={(e) => {
        const by = { ArrowLeft: -1, ArrowRight: 1 }[e.key];
        if (!by) return;
        e.preventDefault();
        onResize(clamp(span + by));
      }}
      onDoubleClick={() => onResize(1)}
    />
  );
}

/** The board's last place: a dashed tile to make a new widget with one of the agents, or load one that exists. */
export function BoardAddTile({ choices, empty }: { choices: BoardChoices; empty: boolean }) {
  const t = useT();
  const [picking, setPicking] = useState(false);
  return (
    <div className="projboard__add">
      <Icons.LayoutGrid size={18} className="projboard__addicon" />
      <p className="projboard__addtext">{empty ? t("board.empty") : t("board.more")}</p>
      <div className="projboard__addactions">
        <Button
          variant="secondary"
          size="sm"
          leadingIcon={<Icons.Plus size={14} />}
          aria-expanded={picking}
          onClick={() => setPicking(!picking)}
        >
          {t("board.create")}
        </Button>
        <Menu
          trigger={
            <Button variant="ghost" size="sm" leadingIcon={<Icons.FolderOpen size={14} />}>
              {t("board.load")}
            </Button>
          }
          items={choices.load}
        />
      </div>
      {picking && (
        <div className="overview__pills projboard__askers">
          {choices.askers.length ? (
            choices.askers.map((a) => (
              <button key={a.id} type="button" className="overview__pill" onClick={() => choices.ask(a.id)}>
                <AgentAvatar name={a.name} blob={blobOf(a)} size={24} animated={false} />
                <span className="overview__pillname">{choices.askerLabel(a)}</span>
              </button>
            ))
          ) : (
            <span className="projboard__addtext">{t("board.noAgents")}</span>
          )}
        </div>
      )}
    </div>
  );
}
