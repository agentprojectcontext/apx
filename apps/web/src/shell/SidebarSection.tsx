import { Icons, Popover, SectionLabel } from "@apx/ui";
import type { ReactNode } from "react";
import { SidebarTooltipButton } from "./SidebarNavRow.tsx";

export function SidebarSection({
  rail,
  title,
  action,
  folded,
  onToggle,
  unread = 0,
  unreadLabel,
}: {
  rail: boolean;
  title: string;
  action?: ReactNode;
  folded?: boolean;
  onToggle?: () => void;
  unread?: number;
  unreadLabel?: string;
}) {
  return (
    <>
      <hr className="sidebar__divider" />
      {rail ? (
        action && <div className="sidebar__railaction">{action}</div>
      ) : (
        <SectionLabel action={action}>
          {onToggle ? (
            <button
              type="button"
              className={folded ? "sidebar__toggle is-closed" : "sidebar__toggle"}
              aria-expanded={!folded}
              aria-label={folded && unread > 0 ? unreadLabel : undefined}
              onClick={onToggle}
            >
              {title}
              <Icons.ChevronDown size={12} className="sidebar__chev" />
              {folded && unread > 0 && <span className="apx-nav__count is-attention">{unread}</span>}
            </button>
          ) : (
            title
          )}
        </SectionLabel>
      )}
    </>
  );
}

export function SidebarOverflow({
  rail,
  title,
  label,
  text,
  count,
  unread = 0,
  active = false,
  open,
  onOpenChange,
  children,
}: {
  rail: boolean;
  title: string;
  label: string;
  text?: string;
  count: number;
  unread?: number;
  active?: boolean;
  open: boolean;
  onOpenChange(open: boolean): void;
  children: ReactNode;
}) {
  return (
    <Popover
      side="right"
      align="start"
      width={280}
      open={open}
      onOpenChange={onOpenChange}
      label={title}
      trigger={
        <SidebarTooltipButton
          label={label}
          className={`apx-nav sidebar__more${rail ? " apx-nav--collapsed" : ""}${active ? " is-active" : ""}`}
        >
          <span className="apx-nav__icon">
            <span className="sidebar__moretile">+{count}</span>
          </span>
          {!rail && <span className="apx-nav__label">{text ?? title}</span>}
          {!rail && unread > 0 && <span className="apx-nav__count is-attention">{unread}</span>}
          {rail && unread > 0 && <span className="apx-nav__dot" aria-hidden="true" />}
        </SidebarTooltipButton>
      }
    >
      <div className="morelist__head">{title}</div>
      <div className="morelist">{children}</div>
    </Popover>
  );
}
