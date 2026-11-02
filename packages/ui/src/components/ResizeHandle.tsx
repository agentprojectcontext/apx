import { type KeyboardEvent, type PointerEvent, type ReactNode, useRef } from "react";
import { cx } from "../cx";
import { Tooltip } from "./Tooltip";

/** A pointer that moves less than this between press and release clicked the handle. */
const CLICK_SLOP = 3;

export interface ResizeHandleProps {
  /** The column's width now (px); for a `top` edge, the panel's height. */
  width: number;
  min: number;
  max: number;
  /** The new width while dragging or with the arrow keys. */
  onResize: (width: number) => void;
  /** Double click: back to the default width. */
  onReset?: () => void;
  /** A drag starts (true) or ends (false): a caller can cover what would swallow the pointer (a native view). */
  onDragChange?: (dragging: boolean) => void;
  /** Accessible name ("Resize the sidebar"). */
  label: string;
  /**
   * Which side of the column it grows from: the handle sits on the column's right edge by default. `top`: a panel at
   * the bottom that grows upwards (a log under a canvas); `width` is then its height.
   */
  edge?: "right" | "left" | "top";
  /** A column that folds to `collapsedWidth`: a click or Enter toggles it, a drag past halfway to `min` snaps it. */
  collapsed?: boolean;
  collapsedWidth?: number;
  onCollapsedChange?: (collapsed: boolean) => void;
  /** Shown on hover: what a click and a drag do here ("Click to fold"). */
  hint?: ReactNode;
  className?: string;
}

/**
 * The edge of a column you drag to change its width (sidebar, chat list, a list beside its detail). Arrows move it
 * 16px from the keyboard; a double click resets it. A foldable column also folds and unfolds from it.
 */
export function ResizeHandle({
  width,
  min,
  max,
  onResize,
  onReset,
  onDragChange,
  label,
  edge = "right",
  collapsed = false,
  collapsedWidth = 0,
  onCollapsedChange,
  hint,
  className,
}: ResizeHandleProps) {
  const start = useRef<{ x: number; w: number; moved: boolean; folded: boolean } | undefined>(undefined);
  const vertical = edge === "top";
  const foldable = onCollapsedChange != null;
  const clamp = (w: number) => Math.round(Math.min(max, Math.max(min, w)));
  const down = (e: PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    start.current = { x: vertical ? e.clientY : e.clientX, w: width, moved: false, folded: collapsed };
    onDragChange?.(true);
  };
  const move = (e: PointerEvent<HTMLDivElement>) => {
    const s = start.current;
    if (!s) return;
    const dx = (vertical ? e.clientY : e.clientX) - s.x;
    const grow = edge === "right" ? dx : -dx;
    if (!foldable) {
      onResize(clamp(s.w + grow));
      return;
    }
    if (Math.abs(dx) > CLICK_SLOP) s.moved = true;
    if (!s.moved) return;
    // Measured from what is on screen when the drag began: the rail, or the open column.
    const proposed = (s.folded ? collapsedWidth : s.w) + grow;
    const fold = proposed < (collapsedWidth + min) / 2;
    if (fold !== collapsed) onCollapsedChange(fold);
    // Folding keeps the width the column had, so unfolding brings it back.
    if (fold) {
      if (!s.folded && width !== s.w) onResize(s.w);
    } else onResize(clamp(proposed));
  };
  const end = (clicked: boolean) => {
    const s = start.current;
    if (!s) return;
    start.current = undefined;
    onDragChange?.(false);
    if (clicked && foldable && !s.moved) onCollapsedChange(!collapsed);
  };
  const key = (e: KeyboardEvent<HTMLDivElement>) => {
    if (foldable && (e.key === "Enter" || e.key === " ")) {
      e.preventDefault();
      onCollapsedChange(!collapsed);
      return;
    }
    const grow = vertical ? "ArrowDown" : "ArrowRight";
    const shrink = vertical ? "ArrowUp" : "ArrowLeft";
    const step = e.key === grow ? 16 : e.key === shrink ? -16 : 0;
    if (!step) return;
    e.preventDefault();
    const delta = edge === "right" ? step : -step;
    if (foldable && collapsed) {
      if (delta > 0) onCollapsedChange(false);
      return;
    }
    // Past the narrowest width, the next step folds it.
    if (foldable && delta < 0 && width <= min) onCollapsedChange(true);
    else onResize(clamp(width + delta));
  };
  const handle = (
    // biome-ignore lint/a11y/useSemanticElements: a separator that moves is the WAI-ARIA window splitter pattern.
    <div
      role="separator"
      aria-orientation={vertical ? "horizontal" : "vertical"}
      aria-label={label}
      aria-valuenow={foldable && collapsed ? collapsedWidth : width}
      aria-valuemin={foldable ? collapsedWidth : min}
      aria-valuemax={max}
      tabIndex={0}
      className={cx("apx-resize", `apx-resize--${edge}`, foldable && "apx-resize--foldable", className)}
      data-collapsed={foldable ? collapsed : undefined}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={() => end(true)}
      onPointerCancel={() => end(false)}
      onKeyDown={key}
      onDoubleClick={onReset}
    />
  );
  if (!hint) return handle;
  const side = edge === "top" ? "top" : edge === "left" ? "left" : "right";
  return (
    <Tooltip content={hint} side={side}>
      {handle}
    </Tooltip>
  );
}
