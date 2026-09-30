import type { ReactNode } from "react";
import { cx } from "../cx";

export interface MessageProps {
  /** agent = left, soft bubble; user = right, ink bubble (green in classic). */
  from?: "agent" | "user";
  /** Message body — text, StepList, EntityCard, VoiceNote… */
  children: ReactNode;
  /** Optional avatar at the left of agent messages (classic shows it; minimal usually omits it). */
  avatar?: ReactNode;
  /** Line under the bubble — MessageMeta, a timestamp. */
  meta?: ReactNode;
  /** Reaction emoji pinned to the bubble's bottom corner. */
  reactions?: ReactNode;
  /** bubble = text; bare = no bubble, for media and cards that carry their own surface. */
  variant?: "bubble" | "bare";
  /** Consecutive message from the same side: tighter top spacing. */
  grouped?: boolean;
  className?: string;
}

/** One chat message. Stack several for a turn; the agent's tools go in an ActionGroup between them. */
export function Message({
  from = "agent",
  children,
  avatar,
  meta,
  reactions,
  variant = "bubble",
  grouped = false,
  className,
}: MessageProps) {
  return (
    <div className={cx("apx-msg", `apx-msg--${from}`, grouped && "is-grouped", className)}>
      {from === "agent" && avatar && <span className="apx-msg__avatar">{avatar}</span>}
      <div className="apx-msg__col">
        <div className={cx(variant === "bubble" ? "apx-msg__bubble" : "apx-msg__bare")}>
          {children}
          {reactions && <span className="apx-msg__reactions">{reactions}</span>}
        </div>
        {meta && <div className="apx-msg__meta">{meta}</div>}
      </div>
    </div>
  );
}
