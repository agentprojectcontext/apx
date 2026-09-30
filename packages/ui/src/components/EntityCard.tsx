import type { ReactNode } from "react";
import { cx } from "../cx";

export interface EntityCardProps {
  /** Small line above the title: kind of thing ("Email draft", "Task", "Routine"). */
  eyebrow?: ReactNode;
  /** Leading icon for the eyebrow. */
  icon?: ReactNode;
  title?: ReactNode;
  /** Status Badge on the top-right. */
  status?: ReactNode;
  /** Key/value rows ("To", "Subject", "Due") shown under the title. */
  fields?: { label: ReactNode; value: ReactNode }[];
  /** Body: draft text, description, checklist. */
  children?: ReactNode;
  /** Action Buttons at the bottom ("Send email" primary, "Discard" secondary). */
  actions?: ReactNode;
  className?: string;
}

/** A thing the agent produced or proposes, inline in the chat: draft, task, routine, commitment — with its actions. */
export function EntityCard({ eyebrow, icon, title, status, fields, children, actions, className }: EntityCardProps) {
  return (
    <div className={cx("apx-entity", className)}>
      <div className="apx-entity__sheet">
        {(eyebrow || status) && (
          <div className="apx-entity__top">
            {eyebrow && (
              <span className="apx-entity__eyebrow">
                {icon}
                {eyebrow}
              </span>
            )}
            {status}
          </div>
        )}
        {title && <div className="apx-entity__title">{title}</div>}
        {fields && fields.length > 0 && (
          <dl className="apx-entity__fields">
            {fields.map((f, i) => (
              <div key={i} className="apx-entity__field">
                <dt>{f.label}</dt>
                <dd>{f.value}</dd>
              </div>
            ))}
          </dl>
        )}
        {children && <div className="apx-entity__body">{children}</div>}
      </div>
      {actions && <div className="apx-entity__actions">{actions}</div>}
    </div>
  );
}
