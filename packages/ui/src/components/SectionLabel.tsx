import type { ReactNode } from "react";
import { cx } from "../cx";

export interface SectionLabelProps {
  children: ReactNode;
  /** Right-side slot: a "+" IconButton, a count. */
  action?: ReactNode;
  className?: string;
}

/** Small heading that groups sidebar or list sections ("Projects", "Loose chats"). */
export function SectionLabel({ children, action, className }: SectionLabelProps) {
  return (
    <div className={cx("apx-section-label", className)}>
      <span>{children}</span>
      {action}
    </div>
  );
}
