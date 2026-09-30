import type { ReactNode } from "react";
import { cx } from "../cx";

export interface NavItemProps {
  label: ReactNode;
  /** Leading icon (lucide, 16px) or a small AgentAvatar/project avatar. */
  icon?: ReactNode;
  /** Right-aligned counter (Inbox 3). */
  count?: number;
  /** Highlight the count as needing attention. */
  attention?: boolean;
  active?: boolean;
  /** Indent level for nested items (a project's sub-sections). */
  depth?: 0 | 1;
  href?: string;
  onClick?: () => void;
  className?: string;
}

/** Sidebar navigation row: Home, Inbox, In progress, a project, a project section. */
export function NavItem({
  label,
  icon,
  count,
  attention = false,
  active = false,
  depth = 0,
  href,
  onClick,
  className,
}: NavItemProps) {
  const cls = cx("apx-nav", depth === 1 && "apx-nav--nested", active && "is-active", className);
  const inner = (
    <>
      {icon && <span className="apx-nav__icon">{icon}</span>}
      <span className="apx-nav__label">{label}</span>
      {count != null && count > 0 && <span className={cx("apx-nav__count", attention && "is-attention")}>{count}</span>}
    </>
  );
  return href ? (
    <a className={cls} href={href} aria-current={active ? "page" : undefined} onClick={onClick}>
      {inner}
    </a>
  ) : (
    <button type="button" className={cls} aria-current={active ? "page" : undefined} onClick={onClick}>
      {inner}
    </button>
  );
}
