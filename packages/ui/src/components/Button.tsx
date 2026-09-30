import { type ButtonHTMLAttributes, forwardRef, type ReactNode } from "react";
import { cx } from "../cx";
import { Spinner } from "./Spinner";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** primary = the one main action (ink in minimal, APX green in classic); secondary = soft fill; outline; ghost = toolbar; danger; link. */
  variant?: "primary" | "secondary" | "outline" | "ghost" | "danger" | "link";
  size?: "sm" | "md" | "lg";
  /** Icon before the label (e.g. a lucide icon). */
  leadingIcon?: ReactNode;
  /** Icon after the label (e.g. a chevron). */
  trailingIcon?: ReactNode;
  /** Shows a spinner in place of the leading icon and disables the button. */
  loading?: boolean;
  /** Stretch to the container width. */
  fullWidth?: boolean;
  onClick?: ButtonHTMLAttributes<HTMLButtonElement>["onClick"];
  disabled?: boolean;
  type?: "button" | "submit" | "reset";
}

/** Text button. One `primary` per view; everything else secondary/ghost. Pill-shaped in minimal, 8px radius in classic. */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = "primary",
    size = "md",
    leadingIcon,
    trailingIcon,
    loading = false,
    fullWidth = false,
    className,
    children,
    disabled,
    type = "button",
    ...rest
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cx("apx-btn", `apx-btn--${variant}`, `apx-btn--${size}`, fullWidth && "apx-btn--full", className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <Spinner size={size === "lg" ? 16 : 14} /> : leadingIcon}
      {children != null && <span className="apx-btn__label">{children}</span>}
      {trailingIcon}
    </button>
  );
});
