import { ArrowLeft } from "lucide-react";
import { type CSSProperties, type ReactNode, useState } from "react";
import { cx } from "../cx";
import { ResizeHandle } from "./ResizeHandle";

const LIST = { initial: 340, min: 240, max: 560 };

/** The list's width this viewer last left it at (a per-browser convenience; absent storage just means the default). */
function remembered(key: string | undefined): number {
  if (!key) return LIST.initial;
  try {
    const v = Number(localStorage.getItem(`apx.mdetail.${key}`));
    return v >= LIST.min && v <= LIST.max ? v : LIST.initial;
  } catch {
    return LIST.initial;
  }
}

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
  /** Lets the list be resized, remembering its width under this name ("skills", "mcp"). */
  resizeKey?: string;
  className?: string;
}

/**
 * A narrow list beside the detail of what is selected: Resources (skills, MCP, integrations), channels and their
 * contacts, routines. Below 1040px it becomes one screen at a time, with "back" on the detail.
 */
export function MasterDetail({
  list,
  detail,
  empty,
  onBack,
  backLabel,
  listLabel,
  resizeKey,
  className,
}: MasterDetailProps) {
  const [width, setWidth] = useState(() => remembered(resizeKey));
  const resize = (w: number) => {
    setWidth(w);
    try {
      if (resizeKey) localStorage.setItem(`apx.mdetail.${resizeKey}`, String(w));
    } catch {}
  };
  return (
    <div
      className={cx("apx-mdetail", detail !== undefined && "has-detail", className)}
      style={{ "--apx-mdetail-list": `${width}px` } as CSSProperties}
    >
      <nav className="apx-mdetail__list" aria-label={listLabel}>
        {list}
      </nav>
      {resizeKey && (
        <ResizeHandle
          width={width}
          min={LIST.min}
          max={LIST.max}
          onResize={resize}
          onReset={() => resize(LIST.initial)}
          label={listLabel ?? "Resize"}
          className="apx-mdetail__resize"
        />
      )}

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
