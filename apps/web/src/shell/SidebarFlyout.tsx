import { Icons, Popover } from "@apx/ui";
import { type MouseEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { useNav } from "./nav.ts";
import { SidebarTooltipButton } from "./SidebarNavRow.tsx";

/** Whether one of a row's menus (their triggers say so) is open in `el`. */
const menuOpenIn = (el: HTMLElement | null) => Boolean(el?.querySelector("[data-popup-open]"));

/**
 * A sidebar section folded into one row (the compact sidebar): its icon, name and count; resting on it or clicking it
 * opens its items beside it. A dot on the icon says something there waits to be read or is working.
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
  empty,
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
  /** What the flyout says while the section has nothing in it. */
  empty?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const list = useRef<HTMLDivElement>(null);
  // A row's menu (right click or its "…") opens outside the flyout: leaving for it must not close the flyout, which
  // would take the row and its menu with it. The flyout closes once that menu does.
  const deferred = useRef(false);
  const change = (next: boolean) => {
    deferred.current = !next && menuOpenIn(list.current);
    if (!deferred.current) setOpen(next);
  };
  useEffect(() => {
    const el = list.current;
    if (!open || !el) return;
    const watch = new MutationObserver(() => {
      if (deferred.current && !menuOpenIn(el)) {
        deferred.current = false;
        setOpen(false);
      }
    });
    watch.observe(el, { subtree: true, attributes: true, attributeFilter: ["data-popup-open"] });
    return () => watch.disconnect();
  }, [open]);
  // A pick inside (a row, or an item of its menu) is done with the flyout, even when it keeps the same place (an
  // account narrows the Inbox already shown). A row's "…" only opens its menu.
  const picked = (event: MouseEvent<HTMLDivElement>) => {
    const target = (event.target as HTMLElement).closest("button, [role='menuitem']");
    if (!target || target.closest("[data-sidebar-actions]")) return;
    deferred.current = false;
    setOpen(false);
  };
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
      onOpenChange={change}
      openOnHover
      label={title}
      className="sideflyout"
      trigger={
        <SidebarTooltipButton
          label={title}
          tip={rail && !open}
          aria-expanded={open}
          className={`apx-nav sideflyout__row${rail ? " apx-nav--collapsed" : ""}${active || open ? " is-active" : ""}`}
        >
          <span className="apx-nav__icon sideflyout__icon">
            {icon}
            {(unread > 0 || running) && <span className="sideflyout__alert" aria-hidden="true" />}
          </span>
          {!rail && (
            <>
              <span className="apx-nav__label">{title}</span>
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
      {empty && !count ? (
        <p className="sideflyout__empty">{empty}</p>
      ) : (
        // biome-ignore lint/a11y/noStaticElementInteractions: it only listens for a pick its rows already handle.
        // biome-ignore lint/a11y/useKeyWithClickEvents: Enter on a row is a click, so it lands here too.
        <div ref={list} className="sideflyout__list" onClick={picked}>
          {children}
        </div>
      )}
    </Popover>
  );
}
