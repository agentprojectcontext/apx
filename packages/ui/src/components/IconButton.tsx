import { type ButtonHTMLAttributes, forwardRef, type ReactNode } from "react";
import { cx } from "../cx";

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  /** Accessible name — required, since the button has no visible text. */
  label: string;
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
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={label}
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
});
