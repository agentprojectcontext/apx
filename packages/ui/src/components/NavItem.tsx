import type { ReactNode } from "react";
import { cx } from "../cx";
import { Tooltip } from "./Tooltip";

export interface NavItemProps {
  label: ReactNode;
  /** Leading icon (lucide, 16px) or a small AgentAvatar/project avatar. */
  icon?: ReactNode;
  /** Right-aligned counter (Inbox 3). */
  count?: number;
  /** Highlight the count as needing attention. */
  attention?: boolean;
  /** Right-aligned slot after the count: a lock icon, a running dot. */
  trailing?: ReactNode;
  active?: boolean;
  /** Icon-only rail mode: hides label, count and trailing; the label becomes the tooltip/aria-label. */
  collapsed?: boolean;
  /** Indent level for nested items (a project's sub-sections). */
  depth?: 0 | 1;
  /** Shown but not clickable (a feature that is coming). */
  disabled?: boolean;
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
  trailing,
  active = false,
  collapsed = false,
  depth = 0,
  disabled = false,
  href,
  onClick,
  className,
}: NavItemProps) {
  const cls = cx(
    "apx-nav",
    depth === 1 && "apx-nav--nested",
    collapsed && "apx-nav--collapsed",
    active && "is-active",
    disabled && "is-disabled",
    className,
  );
  const name = collapsed && typeof label === "string" ? label : undefined;
  const badge = count != null && count > 0 && (
    <span className={cx("apx-nav__count", attention && "is-attention")}>{count}</span>
  );
  const inner = (
    <>
      {icon && <span className="apx-nav__icon">{icon}</span>}
      {!collapsed && <span className="apx-nav__label">{label}</span>}
      {!collapsed && badge}
      {!collapsed && trailing && <span className="apx-nav__trailing">{trailing}</span>}
      {collapsed && count != null && count > 0 && <span className="apx-nav__dot" aria-hidden="true" />}
    </>
  );
  const el = href ? (
    <a className={cls} href={href} aria-current={active ? "page" : undefined} aria-label={name} onClick={onClick}>
      {inner}
    </a>
  ) : (
    <button
      type="button"
      className={cls}
      aria-current={active ? "page" : undefined}
      aria-label={name}
      disabled={disabled}
      onClick={onClick}
    >
      {inner}
    </button>
  );
  // In the rail only the icon shows: its name comes up beside it.
  return name ? (
    <Tooltip content={name} side="right">
      {el}
    </Tooltip>
  ) : (
    el
  );
}
