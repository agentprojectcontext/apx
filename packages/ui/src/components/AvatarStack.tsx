import { Children, type ReactNode } from "react";
import { cx } from "../cx";

export interface AvatarStackProps {
  /** Avatar / AgentAvatar elements, all the same size. */
  children: ReactNode;
  /** Show at most this many, then a "+N" chip. */
  max?: number;
  /** Size of the children — sizes the "+N" chip and the overlap. */
  size?: number;
  className?: string;
}

/** Overlapping avatars for group chats and "who's working on this". */
export function AvatarStack({ children, max = 4, size = 24, className }: AvatarStackProps) {
  const all = Children.toArray(children);
  const shown = all.slice(0, max);
  const rest = all.length - shown.length;
  return (
    <span className={cx("apx-avatar-stack", className)} style={{ ["--apx-stack-size" as string]: `${size}px` }}>
      {shown.map((c, i) => (
        <span key={i} className="apx-avatar-stack__item">
          {c}
        </span>
      ))}
      {rest > 0 && (
        <span className="apx-avatar-stack__more" style={{ width: size, height: size }}>
          +{rest}
        </span>
      )}
    </span>
  );
}
