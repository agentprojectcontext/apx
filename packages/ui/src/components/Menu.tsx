import { Menu as BaseMenu } from "@base-ui/react/menu";
import type { ReactElement } from "react";
import { cx } from "../cx";
import { useApx } from "./ApxProvider";
import { MenuEntries, type MenuEntry } from "./menuEntries";

export type { MenuEntry };

export interface MenuProps {
  /** The element that opens the menu (usually an IconButton with a ⋯ icon). */
  trigger: ReactElement;
  items: MenuEntry[];
  side?: "top" | "bottom" | "left" | "right";
  align?: "start" | "center" | "end";
  /** Start open (for docs/previews). */
  defaultOpen?: boolean;
  className?: string;
}

/** Dropdown/overflow menu: row actions (⋯), "New" menus, account menu. */
export function Menu({ trigger, items, side = "bottom", align = "start", defaultOpen, className }: MenuProps) {
  const { portalRef } = useApx();
  return (
    <BaseMenu.Root defaultOpen={defaultOpen} modal={false}>
      <BaseMenu.Trigger render={trigger} />
      <BaseMenu.Portal container={portalRef}>
        <BaseMenu.Positioner side={side} align={align} sideOffset={6}>
          <BaseMenu.Popup className={cx("apx-menu", className)}>
            <MenuEntries items={items} portal={portalRef} />
          </BaseMenu.Popup>
        </BaseMenu.Positioner>
      </BaseMenu.Portal>
    </BaseMenu.Root>
  );
}
