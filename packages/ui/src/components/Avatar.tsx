import type { CSSProperties, ReactNode } from "react";
import { hashSeed } from "../blobs/seed";
import { cx } from "../cx";

const HUES = [152, 262, 217, 24, 340, 190, 45, 290];

export interface AvatarProps {
  /** Person or agent name — used for initials, color and alt text. */
  name: string;
  /** Image URL. Falls back to emoji, then initials. */
  src?: string;
  emoji?: string;
  /** Pixel size (default 32). */
  size?: number;
  /** circle for people/agents; rounded square for projects. */
  shape?: "circle" | "square";
  /** Presence dot on the bottom-right. */
  status?: "online" | "busy" | "away" | "offline";
  className?: string;
  style?: CSSProperties;
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (
    (parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : (parts[0]?.[1] ?? ""))
  ).toUpperCase();
}

/** Person/project avatar: photo → emoji → initials on a name-derived tint. For agents use AgentAvatar. */
export function Avatar({ name, src, emoji, size = 32, shape = "circle", status, className, style }: AvatarProps) {
  const hue = HUES[hashSeed(name) % HUES.length];
  let content: ReactNode;
  if (src) content = <img src={src} alt="" className="apx-avatar__img" />;
  else if (emoji) content = <span className="apx-avatar__emoji">{emoji}</span>;
  else content = <span>{initials(name)}</span>;
  return (
    <span
      className={cx("apx-avatar", `apx-avatar--${shape}`, !src && !emoji && "apx-avatar--initials", className)}
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.38),
        ["--apx-avatar-hue" as string]: hue,
        ...style,
      }}
      role="img"
      aria-label={status ? `${name} (${status})` : name}
    >
      {content}
      {status && <span className={cx("apx-avatar__status", `is-${status}`)} />}
    </span>
  );
}
