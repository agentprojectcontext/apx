import type { ReactNode } from "react";
import { cx } from "../cx";

export interface SystemNoteProps {
  /** Sentence with inline AgentChips / bold names: "Updated memory for <AgentChip/>". */
  children: ReactNode;
  /** Small leading icon (clock for routines, brain for memory). */
  icon?: ReactNode;
  className?: string;
}

/** Centered, muted event line inside a thread: routine created, memory updated, agents joined. */
export function SystemNote({ children, icon, className }: SystemNoteProps) {
  return (
    <div className={cx("apx-sysnote", className)} role="note">
      {icon && <span className="apx-sysnote__icon">{icon}</span>}
      <span>{children}</span>
    </div>
  );
}
