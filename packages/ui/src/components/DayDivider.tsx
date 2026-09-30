import type { ReactNode } from "react";
import { cx } from "../cx";

export interface DayDividerProps {
  /** "Today", "Yesterday", "30/9/2026". */
  label: ReactNode;
  className?: string;
}

/** Date separator between messages. */
export function DayDivider({ label, className }: DayDividerProps) {
  return (
    <div className={cx("apx-daydiv", className)} role="separator">
      <span>{label}</span>
    </div>
  );
}
