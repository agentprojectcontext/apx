import type { ReactNode } from "react";
import { cx } from "../cx";

export interface ConversationRowProps {
  /** Leading avatar — AgentAvatar, Avatar or an AvatarStack for groups (32–36px). */
  avatar: ReactNode;
  title: ReactNode;
  /** Role Tag next to the title (e.g. <Tag kind="role">Super-agente</Tag>). */
  titleTag?: ReactNode;
  /** Timestamp, already formatted ("Yesterday", "1:35 p. m."). */
  time?: ReactNode;
  /** Last message, one line, truncated. */
  preview?: ReactNode;
  /** Context Tags under the title (project, channel, "Agent ↔ agent"). Classic shows them; minimal keeps rows two-line. */
  tags?: ReactNode;
  /** Third line, 11px subtle: sessions, channels, kind ("Group · 3 agents"). */
  meta?: ReactNode;
  /** Unread count; shows a dot/number and bolds the title. */
  unread?: number;
  /** Replace the preview with a typing line. */
  typing?: ReactNode;
  selected?: boolean;
  onClick?: () => void;
  className?: string;
}

/** A thread in the conversation list: avatar, title + time, one-line preview. */
export function ConversationRow({
  avatar,
  title,
  titleTag,
  time,
  preview,
  tags,
  meta,
  unread = 0,
  typing,
  selected = false,
  onClick,
  className,
}: ConversationRowProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={selected || undefined}
      className={cx("apx-convrow", selected && "is-selected", unread > 0 && "is-unread", className)}
    >
      <span className="apx-convrow__avatar">{avatar}</span>
      <span className="apx-convrow__main">
        <span className="apx-convrow__top">
          <span className="apx-convrow__title">{title}</span>
          {titleTag}
          {time && <span className="apx-convrow__time">{time}</span>}
        </span>
        {tags && <span className="apx-convrow__tags">{tags}</span>}
        <span className="apx-convrow__bottom">
          <span className={cx("apx-convrow__preview", typing && "is-typing")}>{typing ?? preview}</span>
          {unread > 0 && <span className="apx-convrow__unread">{unread}</span>}
        </span>
        {meta && <span className="apx-convrow__meta">{meta}</span>}
      </span>
    </button>
  );
}
