import type { ReactNode } from "react";
import { cx } from "../cx";

export interface EmptyStateProps {
  /** Short heading ("No hay chats todavía"). */
  title?: ReactNode;
  /** Explanation under the title. */
  children?: ReactNode;
  /** Leading icon (lucide, ~20px). */
  icon?: ReactNode;
  /** A Button under the text ("Nuevo chat", "Reintentar"). */
  action?: ReactNode;
  /** dashed = bordered box inside a list or card; plain = centered in a whole pane. */
  variant?: "dashed" | "plain";
  size?: "sm" | "lg";
  className?: string;
}

/** Placeholder for an empty list, pane or failed load: icon, title, a line of text and an optional action. */
export function EmptyState({
  title,
  children,
  icon,
  action,
  variant = "plain",
  size = "sm",
  className,
}: EmptyStateProps) {
  return (
    <div className={cx("apx-empty", `apx-empty--${variant}`, `apx-empty--${size}`, className)}>
      {icon && <span className="apx-empty__icon">{icon}</span>}
      {title && <div className="apx-empty__title">{title}</div>}
      {children && <div className="apx-empty__text">{children}</div>}
      {action && <div className="apx-empty__action">{action}</div>}
    </div>
  );
}
