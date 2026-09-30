import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "../cx";

export interface TagProps extends HTMLAttributes<HTMLSpanElement> {
  /**
   * role = agent role next to a name ("Super-agente"; mono uppercase + green outline in classic);
   * meta = context chip under a row (project, channel, "Agente ↔ agente");
   * skill = a skill/tool reference in a message (mono, dashed).
   */
  kind?: "role" | "meta" | "skill";
  /** Small leading icon (lucide, 12px). */
  icon?: ReactNode;
  children?: ReactNode;
}

/** Metadata chip: agent role, project/channel context, skill reference. */
export function Tag({ kind = "meta", icon, className, children, ...rest }: TagProps) {
  return (
    <span className={cx("apx-tag", `apx-tag--${kind}`, className)} {...rest}>
      {icon}
      {children}
    </span>
  );
}
