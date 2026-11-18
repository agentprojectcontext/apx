import type { ReactNode } from "react";
import { cx } from "../cx";
import { Icons } from "../icons";

export interface CatalogRowProps {
  /** Its icon or logo (36px). */
  leading?: ReactNode;
  title: ReactNode;
  /** Beside the title: a Badge that says where it comes from. */
  badge?: ReactNode;
  /** One line of what it is. */
  description?: ReactNode;
  /** A muted third line: what it brings and who from. */
  meta?: ReactNode;
  /** Its one button (Add, Connect). Clicks on it do not open the row. */
  action?: ReactNode;
  /** In place of a button, where it stands: "Connected" with a check, or why it waits with a warning dot. */
  status?: { label: ReactNode; tone?: "done" | "waiting" | "neutral" };
  onOpen?: () => void;
  className?: string;
}

/** A row of a catalog (Marketplace, Claude's plugin lists): logo, name and badge, one line, a muted line, one action. */
export function CatalogRow({
  leading,
  title,
  badge,
  description,
  meta,
  action,
  status,
  onOpen,
  className,
}: CatalogRowProps) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: the row holds its own button, which a <button> cannot contain
    <div
      className={cx("apx-catalogrow", className)}
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget || (e.key !== "Enter" && e.key !== " ")) return;
        e.preventDefault();
        onOpen?.();
      }}
    >
      <div className="apx-catalogrow__inner">
        {leading && <span className="apx-catalogrow__lead">{leading}</span>}
        <span className="apx-catalogrow__main">
          <span className="apx-catalogrow__title">
            <b>{title}</b>
            {badge}
          </span>
          {description && <span className="apx-catalogrow__desc">{description}</span>}
          {meta && <span className="apx-catalogrow__meta">{meta}</span>}
        </span>
        {(action || status) && (
          // biome-ignore lint/a11y/noStaticElementInteractions: only keeps a click on its button from opening the row
          // biome-ignore lint/a11y/useKeyWithClickEvents: the button inside handles its own keys
          <span className="apx-catalogrow__end" onClick={(e) => e.stopPropagation()}>
            {action ??
              (status && (
                <span className={cx("apx-catalogrow__status", `is-${status.tone ?? "neutral"}`)}>
                  {status.tone === "done" ? (
                    <Icons.Check size={14} aria-hidden="true" />
                  ) : status.tone === "waiting" ? (
                    <span className="apx-catalogrow__dot" aria-hidden="true" />
                  ) : null}
                  {status.label}
                </span>
              ))}
          </span>
        )}
      </div>
    </div>
  );
}
