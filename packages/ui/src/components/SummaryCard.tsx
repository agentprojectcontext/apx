import type { ReactNode } from "react";
import { cx } from "../cx";

export interface SummaryCardProps {
  /** Its mark (an app's logo), before the title. */
  icon?: ReactNode;
  /** Absent: a card of sections only (a page that already shows the name above it). */
  title?: ReactNode;
  /** Quiet text beside the title (a version). */
  meta?: ReactNode;
  /** A label after the title (where it comes from). */
  badge?: ReactNode;
  /** One line under the title. */
  description?: ReactNode;
  /** Right of the head: its state. */
  aside?: ReactNode;
  /** soft: filled, inside a dialog. outline: bordered, on a page. */
  variant?: "soft" | "outline";
  className?: string;
  children?: ReactNode;
}

/** A quiet card that sums a thing up before deciding on it: who it is, what it brings, where it comes from. */
export function SummaryCard({
  icon,
  title,
  meta,
  badge,
  description,
  aside,
  variant = "soft",
  className,
  children,
}: SummaryCardProps) {
  return (
    <section className={cx("apx-summary", `apx-summary--${variant}`, className)}>
      {title && (
        <div className="apx-summary__head">
          {icon && <span className="apx-summary__mark">{icon}</span>}
          <div className="apx-summary__titles">
            <div className="apx-summary__title">
              <span className="apx-summary__name">{title}</span>
              {meta && <span className="apx-summary__meta">{meta}</span>}
              {badge}
            </div>
            {description && <p className="apx-summary__desc">{description}</p>}
          </div>
          {aside && <div className="apx-summary__aside">{aside}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

/** A group inside the card, with a small muted heading. */
export function SummarySection({ title, children }: { title?: ReactNode; children: ReactNode }) {
  return (
    <div className="apx-summary__sec">
      {title && <h5 className="apx-summary__sectitle">{title}</h5>}
      {children}
    </div>
  );
}

/** One thing it brings: a small icon, a bold name and a muted line ("Connection with Stripe — 8 tools: …"). */
export function SummaryItem({ icon, title, children }: { icon: ReactNode; title: ReactNode; children?: ReactNode }) {
  return (
    <div className="apx-summary__item">
      <span className="apx-summary__icon">{icon}</span>
      <span className="apx-summary__body">
        <b>{title}</b>
        {children && <span className="apx-summary__line">{children}</span>}
      </span>
    </div>
  );
}

/** A line to read before deciding: neutral, a warning (code that runs here) or good news (files checked). */
export function SummaryNote({
  tone = "neutral",
  icon,
  rule,
  children,
}: {
  tone?: "neutral" | "warning" | "brand";
  icon?: ReactNode;
  /** A rule above it, closing the card. */
  rule?: boolean;
  children: ReactNode;
}) {
  return (
    <p className={cx("apx-summary__note", `apx-summary__note--${tone}`, rule && "apx-summary__note--rule")}>
      {icon && <span className="apx-summary__noteicon">{icon}</span>}
      <span>{children}</span>
    </p>
  );
}
