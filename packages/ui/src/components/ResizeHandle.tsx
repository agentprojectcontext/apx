import { type KeyboardEvent, type PointerEvent, useRef } from "react";
import { cx } from "../cx";

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
  className?: string;
}

/**
 * The edge of a column you drag to change its width (sidebar, chat list, a list beside its detail). Arrows move it
 * 16px from the keyboard; a double click resets it.
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
  className,
}: ResizeHandleProps) {
  const start = useRef<{ x: number; w: number } | undefined>(undefined);
  const vertical = edge === "top";
  const clamp = (w: number) => Math.round(Math.min(max, Math.max(min, w)));
  const down = (e: PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    start.current = { x: vertical ? e.clientY : e.clientX, w: width };
    onDragChange?.(true);
  };
  const move = (e: PointerEvent<HTMLDivElement>) => {
    if (!start.current) return;
    const dx = (vertical ? e.clientY : e.clientX) - start.current.x;
    onResize(clamp(start.current.w + (edge === "right" ? dx : -dx)));
  };
  const up = () => {
    if (!start.current) return;
    start.current = undefined;
    onDragChange?.(false);
  };
  const key = (e: KeyboardEvent<HTMLDivElement>) => {
    const grow = vertical ? "ArrowDown" : "ArrowRight";
    const shrink = vertical ? "ArrowUp" : "ArrowLeft";
    const step = e.key === grow ? 16 : e.key === shrink ? -16 : 0;
    if (!step) return;
    e.preventDefault();
    onResize(clamp(width + (edge === "right" ? step : -step)));
  };
  return (
    // biome-ignore lint/a11y/useSemanticElements: a separator that moves is the WAI-ARIA window splitter pattern.
    <div
      role="separator"
      aria-orientation={vertical ? "horizontal" : "vertical"}
      aria-label={label}
      aria-valuenow={width}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      className={cx("apx-resize", `apx-resize--${edge}`, className)}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onKeyDown={key}
      onDoubleClick={onReset}
    />
  );
}
