import { Icons, Popover } from "@apx/ui";
import { type ReactNode, useEffect, useState } from "react";
import { useNav } from "./nav.ts";
import { SidebarTooltipButton } from "./SidebarNavRow.tsx";

/**
 * A sidebar section folded into one row (the compact sidebar): its icon, name and count; resting on it or clicking it
 * opens its items beside it. A dot on the icon says something there waits to be read; one at the end, that something
 * is working.
 */
export function SidebarFlyout({
  rail,
  title,
  icon,
  count,
  unread = 0,
  running = false,
  active = false,
  action,
  children,
}: {
  rail: boolean;
  title: string;
  icon: ReactNode;
  count?: number;
  unread?: number;
  running?: boolean;
  active?: boolean;
  /** A control at the right of the flyout's title (its "+"). */
  action?: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  // A pick inside opens another place: the flyout steps aside for it.
  const where = useNav((s) => `${s.view}|${s.projectId}|${s.channelId}|${s.engineId}|${s.appId}`);
  useEffect(() => {
    if (where) setOpen(false);
  }, [where]);
  return (
    <Popover
      side="right"
      align="start"
      width={272}
      open={open}
      onOpenChange={setOpen}
      openOnHover
      label={title}
      className="sideflyout"
      trigger={
        <SidebarTooltipButton
          label={title}
          aria-expanded={open}
          className={`apx-nav sideflyout__row${rail ? " apx-nav--collapsed" : ""}${active || open ? " is-active" : ""}`}
        >
          <span className="apx-nav__icon sideflyout__icon">
            {icon}
            {unread > 0 && <span className="sideflyout__alert" aria-hidden="true" />}
          </span>
          {!rail && (
            <>
              <span className="apx-nav__label">{title}</span>
              {running && <span className="sidebar__running" aria-hidden="true" />}
              {count != null && count > 0 && <span className="sideflyout__count">{count}</span>}
              <Icons.ChevronRight size={14} className="sideflyout__chev" />
            </>
          )}
        </SidebarTooltipButton>
      }
    >
      <div className="sideflyout__head">
        <span>{title}</span>
        {action}
      </div>
      <div className="sideflyout__list">{children}</div>
    </Popover>
  );
}
