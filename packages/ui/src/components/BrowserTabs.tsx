import { Plus, X } from "lucide-react";
import type { ReactNode } from "react";
import { cx } from "../cx";

export interface BrowserTabItem {
  id: string;
  title: ReactNode;
  /** Shown as the tooltip. */
  url?: string;
  /** Who holds the tab: agent (warning dot), handoff (pulsing warning), user (brand), idle (subtle). */
  holder?: "agent" | "handoff" | "user" | "idle";
}

export interface BrowserTabsProps {
  tabs: BrowserTabItem[];
  value?: string;
  onValueChange?: (id: string) => void;
  /** Shows a close button per tab. */
  onClose?: (id: string) => void;
  /** Shows a trailing "+" button. */
  onNew?: () => void;
  newLabel?: string;
  closeLabel?: string;
  className?: string;
}

/** Horizontal tab strip of the browser side panel: dot by controller, title, optional close and "+". */
export function BrowserTabs({
  tabs,
  value,
  onValueChange,
  onClose,
  onNew,
  newLabel = "Nueva pestaña",
  closeLabel = "Cerrar pestaña",
  className,
}: BrowserTabsProps) {
  return (
    <div className={cx("apx-btabs", className)} role="tablist">
      {tabs.map((t) => (
        <div
          key={t.id}
          role="tab"
          tabIndex={0}
          aria-selected={t.id === value}
          title={t.url}
          className={cx("apx-btabs__tab", t.id === value && "is-active")}
          onClick={() => onValueChange?.(t.id)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onValueChange?.(t.id);
            }
          }}
        >
          <span className={cx("apx-btabs__dot", `is-${t.holder ?? "idle"}`)} aria-hidden="true" />
          <span className="apx-btabs__title">{t.title}</span>
          {onClose && (
            <button
              type="button"
              className="apx-btabs__close"
              aria-label={closeLabel}
              onClick={(e) => {
                e.stopPropagation();
                onClose(t.id);
              }}
            >
              <X size={12} />
            </button>
          )}
        </div>
      ))}
      {onNew && (
        <button type="button" className="apx-btabs__new" aria-label={newLabel} title={newLabel} onClick={onNew}>
          <Plus size={16} />
        </button>
      )}
    </div>
  );
}
