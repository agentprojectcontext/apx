import { Popover as BasePopover } from "@base-ui/react/popover";
import type { ReactElement, ReactNode } from "react";
import { cx } from "../cx";
import { useApx } from "./ApxProvider";

export interface PopoverProps {
  /** The element that toggles the popover. */
  trigger: ReactElement;
  children: ReactNode;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  side?: "top" | "bottom" | "left" | "right";
  align?: "start" | "center" | "end";
  /** Popup width in px (content decides when omitted). */
  width?: number;
  /** Accessible name of the popup. */
  label?: string;
  /** Also opens while the pointer rests on the trigger; a click still opens it on touch. */
  openOnHover?: boolean;
  className?: string;
}

/** Anchored panel with arbitrary content (process list, share picker). For a list of actions use Menu. */
export function Popover({
  trigger,
  children,
  open,
  defaultOpen,
  onOpenChange,
  side = "bottom",
  align = "start",
  width,
  label,
  openOnHover,
  className,
}: PopoverProps) {
  const { portalRef } = useApx();
  return (
    <BasePopover.Root open={open} defaultOpen={defaultOpen} onOpenChange={(o) => onOpenChange?.(o)}>
      <BasePopover.Trigger render={trigger} openOnHover={openOnHover} delay={150} />
      <BasePopover.Portal container={portalRef}>
        <BasePopover.Positioner side={side} align={align} sideOffset={8}>
          <BasePopover.Popup className={cx("apx-popover", className)} style={{ width }} aria-label={label}>
            {children}
          </BasePopover.Popup>
        </BasePopover.Positioner>
      </BasePopover.Portal>
    </BasePopover.Root>
  );
}
