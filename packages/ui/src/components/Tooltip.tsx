import { mergeProps } from "@base-ui/react/merge-props";
import { Tooltip as BaseTooltip } from "@base-ui/react/tooltip";
import { cloneElement, type HTMLAttributes, type ReactElement, type ReactNode, type Ref } from "react";
import { useApx } from "./ApxProvider";

export interface TooltipProps {
  /** Tooltip text. */
  content: ReactNode;
  /** The trigger — a single element (Button, IconButton). */
  children: ReactElement;
  side?: "top" | "bottom" | "left" | "right";
  /** Optional shortcut shown after the text. */
  shortcut?: string;
  /** Surface hints retain the active theme when their content has semantic colors. */
  appearance?: "contrast" | "surface";
  /** Start open (for docs/previews). */
  defaultOpen?: boolean;
  delay?: number;
}

/** What a menu or popover puts on its trigger (ref, handlers, aria) when the trigger is a Tooltip: passed on to the element. */
type Passed = Omit<HTMLAttributes<HTMLElement>, "content" | "children"> & { ref?: Ref<HTMLButtonElement> };

/** Short hint on hover/focus, mostly for IconButtons. Renders in the provider's portal so it keeps the look. */
export function Tooltip({
  content,
  children,
  side = "top",
  shortcut,
  appearance = "contrast",
  defaultOpen,
  delay = 400,
  ...passed
}: TooltipProps & Passed) {
  const { portalRef } = useApx();
  // A hint that may be empty (a conditional title) renders its trigger bare.
  if (content === undefined || content === null || content === false || content === "")
    return Object.keys(passed).length ? cloneElement(children, mergeProps(children.props as object, passed)) : children;
  return (
    <BaseTooltip.Root defaultOpen={defaultOpen}>
      <BaseTooltip.Trigger delay={delay} render={children} {...passed} />
      <BaseTooltip.Portal container={portalRef}>
        <BaseTooltip.Positioner side={side} sideOffset={6}>
          <BaseTooltip.Popup className={`apx-tooltip${appearance === "surface" ? " apx-tooltip--surface" : ""}`}>
            {content}
            {shortcut && <span className="apx-tooltip__kbd">{shortcut}</span>}
          </BaseTooltip.Popup>
        </BaseTooltip.Positioner>
      </BaseTooltip.Portal>
    </BaseTooltip.Root>
  );
}
