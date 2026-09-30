import type { CSSProperties } from "react";
import { cx } from "../cx";

export interface SkeletonProps {
  width?: number | string;
  height?: number | string;
  /** text = rounded line, circle = avatar, block = card/image. */
  shape?: "text" | "circle" | "block";
  className?: string;
  style?: CSSProperties;
}

/** Loading placeholder. Compose several to sketch a row or a card. */
export function Skeleton({ width = "100%", height, shape = "text", className, style }: SkeletonProps) {
  const h = height ?? (shape === "text" ? 12 : shape === "circle" ? width : 80);
  return (
    <span
      className={cx("apx-skeleton", `apx-skeleton--${shape}`, className)}
      style={{ width, height: h, ...style }}
      aria-hidden="true"
    />
  );
}
