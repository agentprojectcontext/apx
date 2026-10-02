import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";
import { cx } from "../cx";

export interface MasterDetailProps {
  /** The list (left column). */
  list: ReactNode;
  /** The selected item's detail; undefined shows `empty` instead. */
  detail?: ReactNode;
  empty?: ReactNode;
  /** Narrow widths show one column: the detail with a back button while something is selected. */
  onBack?: () => void;
  backLabel?: string;
  listLabel?: string;
  className?: string;
}

/**
 * A narrow list beside the detail of what is selected: Resources (skills, MCP, integrations), channels and their
 * contacts, routines. Below 1040px it becomes one screen at a time, with "back" on the detail.
 */
export function MasterDetail({ list, detail, empty, onBack, backLabel, listLabel, className }: MasterDetailProps) {
  return (
    <div className={cx("apx-mdetail", detail !== undefined && "has-detail", className)}>
      <nav className="apx-mdetail__list" aria-label={listLabel}>
        {list}
      </nav>
      <section className="apx-mdetail__detail">
        {detail !== undefined && onBack && (
          <button type="button" className="apx-mdetail__back" onClick={onBack}>
            <ArrowLeft size={14} />
            {backLabel}
          </button>
        )}
        {detail ?? empty}
      </section>
    </div>
  );
}
