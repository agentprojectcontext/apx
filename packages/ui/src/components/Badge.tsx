import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "../cx";

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: "neutral" | "brand" | "violet" | "info" | "warning" | "danger";
  /** soft = tinted fill (default); solid = counters and alerts; outline = quiet status. */
  variant?: "soft" | "solid" | "outline";
  /** Leading status dot in the tone color ("● You're in control"). */
  dot?: boolean;
  children?: ReactNode;
}

/** Status pill or counter: "Draft", "● You're in control", unread "5". For metadata chips use Tag. */
export function Badge({ tone = "neutral", variant = "soft", dot = false, className, children, ...rest }: BadgeProps) {
  return (
    <span className={cx("apx-badge", `apx-badge--${variant}`, `apx-tone--${tone}`, className)} {...rest}>
      {dot && <span className="apx-badge__dot" aria-hidden="true" />}
      {children}
    </span>
  );
}
