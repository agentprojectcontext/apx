import { Menu as BaseMenu } from "@base-ui/react/menu";
import type { ReactElement, ReactNode } from "react";
import { cx } from "../cx";
import { useApx } from "./ApxProvider";

export type MenuEntry =
  | {
      type?: "item";
      label: ReactNode;
      icon?: ReactNode;
      shortcut?: string;
      danger?: boolean;
      disabled?: boolean;
      onSelect?: () => void;
    }
  | { type: "separator" }
  | { type: "label"; label: ReactNode };

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
            {items.map((it, i) => {
              if (it.type === "separator") return <BaseMenu.Separator key={i} className="apx-menu__sep" />;
              if (it.type === "label")
                return (
                  <div key={i} className="apx-menu__label">
                    {it.label}
                  </div>
                );
              return (
                <BaseMenu.Item
                  key={i}
                  className={cx("apx-menu__item", it.danger && "is-danger")}
                  disabled={it.disabled}
                  onClick={it.onSelect}
                >
                  <span className="apx-menu__icon">{it.icon}</span>
                  <span className="apx-menu__text">{it.label}</span>
                  {it.shortcut && <span className="apx-menu__shortcut">{it.shortcut}</span>}
                </BaseMenu.Item>
              );
            })}
          </BaseMenu.Popup>
        </BaseMenu.Positioner>
      </BaseMenu.Portal>
    </BaseMenu.Root>
  );
}
