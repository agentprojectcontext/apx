import { ContextMenu, IconButton, Icons, Menu, type MenuEntry, NavItem, Tooltip } from "@apx/ui";
import { type ButtonHTMLAttributes, forwardRef, type ReactNode, useState } from "react";
import { type T, useT } from "../i18n/index.ts";

/** One visual selection, with sibling buttons so navigation never contains another button. */
export function SidebarNavRow({
  id,
  kind,
  label,
  rail,
  active,
  icon,
  count,
  trailing,
  items,
  onPick,
  order,
  onMove,
  locked = false,
}: {
  id: string;
  kind: "channel" | "project" | "engine";
  label: string;
  rail: boolean;
  active: boolean;
  icon: ReactNode;
  count?: number;
  trailing?: ReactNode;
  items: MenuEntry[];
  onPick(): void;
  order: string[];
  onMove(id: string, index: number): void;
  locked?: boolean;
}) {
  const t = useT();
  const [dragging, setDragging] = useState(false);
  const [drop, setDrop] = useState<"before" | "after">();
  const dragType = `application/x-apx-${kind}`;
  return (
    <ContextMenu
      items={items}
      disabled={dragging}
      render={
        <fieldset
          aria-label={label}
          {...{ [`data-${kind}-id`]: id }}
          draggable={!locked}
          onDragStart={(event) => {
            if ((event.target as HTMLElement).closest("[data-sidebar-actions]")) {
              event.preventDefault();
              return;
            }
            event.dataTransfer.setData(dragType, id);
            event.dataTransfer.effectAllowed = "move";
            setDragging(true);
          }}
          onDragOver={(event) => {
            if (locked || !event.dataTransfer.types.includes(dragType)) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = "move";
            const bounds = event.currentTarget.getBoundingClientRect();
            setDrop(event.clientY > bounds.y + bounds.height / 2 ? "after" : "before");
          }}
          onDragLeave={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDrop(undefined);
          }}
          onDrop={(event) => {
            event.preventDefault();
            const from = event.dataTransfer.getData(dragType);
            const remaining = order.filter((current) => current !== from);
            const at = remaining.indexOf(id);
            const bounds = event.currentTarget.getBoundingClientRect();
            if (!locked && order.includes(from) && at >= 0)
              onMove(from, at + Number(event.clientY > bounds.y + bounds.height / 2));
            setDrop(undefined);
          }}
          onDragEnd={() => {
            setDragging(false);
            setDrop(undefined);
          }}
        />
      }
      className={`sidebar-navrow${kind === "channel" ? " channelsnav__row" : ""}${rail ? " is-rail" : ""}${active ? " is-active" : ""}${dragging ? " is-dragging" : ""}${drop ? ` is-drop-${drop}` : ""}`}
    >
      <NavItem
        collapsed={rail}
        icon={icon}
        label={label}
        count={count}
        attention={(count ?? 0) > 0}
        trailing={trailing}
        active={active}
        onClick={onPick}
      />
      {!rail && (
        <div className="sidebar-navrow__actions" data-sidebar-actions>
          <Menu
            align="end"
            trigger={
              <IconButton
                size="sm"
                className="sidebar-navrow__options"
                label={t("nav.itemOptions", { name: label })}
                icon={<Icons.Ellipsis size={14} />}
              />
            }
            items={items}
          />
        </div>
      )}
    </ContextMenu>
  );
}

/** Forwards popover handlers to the actual button while adding a readable hint. */
export const SidebarTooltipButton = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { label: string }
>(function SidebarTooltipButton({ label, children, ...props }, ref) {
  return (
    <Tooltip content={label} side="right">
      <button type="button" ref={ref} aria-label={label} {...props}>
        {children}
      </button>
    </Tooltip>
  );
});

/** "First", "Up" and "Down" for a row of a section the owner orders by hand. */
export function orderItems(
  t: T,
  id: string,
  order: string[],
  onMove: (id: string, index: number) => void,
): MenuEntry[] {
  const index = order.indexOf(id);
  return [
    { label: t("nav.channelFirst"), icon: <Icons.ChevronUp />, disabled: index === 0, onSelect: () => onMove(id, 0) },
    {
      label: t("nav.channelUp"),
      icon: <Icons.ChevronUp />,
      disabled: index === 0,
      onSelect: () => onMove(id, index - 1),
    },
    {
      label: t("nav.channelDown"),
      icon: <Icons.ChevronDown />,
      disabled: index === order.length - 1,
      onSelect: () => onMove(id, index + 1),
    },
  ];
}
