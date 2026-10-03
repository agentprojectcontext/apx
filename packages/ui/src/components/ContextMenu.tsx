import { ContextMenu as BaseContextMenu } from "@base-ui/react/context-menu";
import type { ReactElement, ReactNode } from "react";
import { cx } from "../cx";
import { useApx } from "./ApxProvider";
import { MenuEntries, type MenuEntry } from "./menuEntries";

export interface ContextMenuProps {
  /** What a right-click (or a long press on touch) opens the menu on. */
  children: ReactNode;
  items: MenuEntry[];
  /** No menu (the children render alone), e.g. while dragging. */
  disabled?: boolean;
  className?: string;
  /** The element that takes the right-click instead of a wrapper (a table row: `<tr />`). */
  render?: ReactElement;
}

/** Right-click menu on an area: the same items as Menu (submenus, checks, danger). */
export function ContextMenu({ children, items, disabled, className, render }: ContextMenuProps) {
  const { portalRef } = useApx();
  return (
    <BaseContextMenu.Root disabled={disabled}>
      <BaseContextMenu.Trigger {...(render ? { render, className } : { className: cx("apx-ctxmenu", className) })}>
        {children}
      </BaseContextMenu.Trigger>
      <BaseContextMenu.Portal container={portalRef}>
        <BaseContextMenu.Positioner>
          <BaseContextMenu.Popup className="apx-menu">
            <MenuEntries items={items} portal={portalRef} />
          </BaseContextMenu.Popup>
        </BaseContextMenu.Positioner>
      </BaseContextMenu.Portal>
    </BaseContextMenu.Root>
  );
}
