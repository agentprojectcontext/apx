import type { CSSProperties, ReactNode } from "react";
import { cx } from "../cx";

export type TileTone = "brand" | "violet" | "info" | "warning" | "danger" | "ink" | "neutral";

export interface ProjectTileProps {
  /** Color pair: a soft tone, `ink` (accent, for external runtimes) or `neutral`. */
  tone?: TileTone;
  /** One or two letters ("A"). Ignored when `icon` or `src` is set. */
  initial?: string;
  /** Lucide icon instead of the letter (channels, apps, runtimes). */
  icon?: ReactNode;
  /** Image (a logo). */
  src?: string;
  /** Pixel size (default 20). */
  size?: number;
  shape?: "square" | "circle";
  /** Accessible name; omit when the tile sits next to visible text. */
  label?: string;
  className?: string;
  style?: CSSProperties;
}

/** Letter, icon or logo on a tone: projects, channels, apps and runtimes in lists and headers. */
export function ProjectTile({
  tone = "neutral",
  initial,
  icon,
  src,
  size = 20,
  shape = "square",
  label,
  className,
  style,
}: ProjectTileProps) {
  // Radius ≈ 30% of the size (20 → 6, 36 → 10, 44 → 12), like the design.
  const box: CSSProperties = {
    width: size,
    height: size,
    borderRadius: shape === "circle" ? "50%" : `${Math.max(4, Math.round(size * 0.29))}px`,
    fontSize: Math.max(8, Math.round(size * 0.4 + 3)),
    ...style,
  };
  const cls = cx("apx-tile", `apx-tile--${tone}`, className);
  const content = src ? <img src={src} alt="" className="apx-tile__img" /> : (icon ?? initial?.slice(0, 2));
  return label ? (
    <span className={cls} style={box} role="img" aria-label={label}>
      {content}
    </span>
  ) : (
    <span className={cls} style={box} aria-hidden="true">
      {content}
    </span>
  );
}
