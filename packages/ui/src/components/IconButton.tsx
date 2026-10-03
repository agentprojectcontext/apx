import { type ButtonHTMLAttributes, forwardRef, type ReactNode } from "react";
import { cx } from "../cx";
import { Tooltip } from "./Tooltip";

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  /** Accessible name — required, since the button has no visible text. Shown as its tooltip unless `tooltip` says more. */
  label: string;
  /** What the tooltip says when the name alone does not explain it; false for none (inside a menu that names it). */
  tooltip?: ReactNode | false;
  tooltipSide?: "top" | "bottom" | "left" | "right";
  /** The icon (a lucide icon element). */
  icon: ReactNode;
  variant?: "ghost" | "secondary" | "outline" | "primary";
  size?: "sm" | "md" | "lg";
  /** circle for floating/composer actions (+, mic, send); square for toolbars. */
  shape?: "circle" | "square";
  /** Toggle state for toolbar buttons (e.g. tools panel open). */
  active?: boolean;
  onClick?: ButtonHTMLAttributes<HTMLButtonElement>["onClick"];
  disabled?: boolean;
  type?: "button" | "submit" | "reset";
}

/** Icon-only button: toolbars, composer (+ / mic / send), row actions. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  {
    label,
    tooltip,
    tooltipSide = "bottom",
    icon,
    variant = "ghost",
    size = "md",
    shape = "square",
    active = false,
    className,
    type = "button",
    ...rest
  },
  ref,
) {
  const button = (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      aria-pressed={active || undefined}
      className={cx(
        "apx-iconbtn",
        `apx-iconbtn--${variant}`,
        `apx-iconbtn--${size}`,
        `apx-iconbtn--${shape}`,
        active && "is-active",
        className,
      )}
      {...rest}
    >
      {icon}
    </button>
  );
  if (tooltip === false) return button;
  return (
    <Tooltip content={tooltip ?? label} side={tooltipSide}>
      {button}
    </Tooltip>
  );
});
