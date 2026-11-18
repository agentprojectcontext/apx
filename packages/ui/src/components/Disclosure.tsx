import type { ReactNode } from "react";
import { cx } from "../cx";
import { Icons } from "../icons";

export interface DisclosureProps {
  /** A small mark before the title (an icon, an app's logo). */
  icon?: ReactNode;
  title: ReactNode;
  /** A muted line under the title: what kind of thing it is. */
  description?: ReactNode;
  /** Right side of the row: its state or one action. Clicks on it do not open the row. */
  trailing?: ReactNode;
  defaultOpen?: boolean;
  className?: string;
  children: ReactNode;
}

/** A bordered row that opens to show its details under it ("Connector · Product Hunt" → address, sign-in, tools). */
export function Disclosure({ icon, title, description, trailing, defaultOpen, className, children }: DisclosureProps) {
  return (
    <details className={cx("apx-disclosure", className)} open={defaultOpen}>
      <summary className="apx-disclosure__row">
        <Icons.ChevronRight size={14} className="apx-disclosure__chev" aria-hidden="true" />
        {icon && <span className="apx-disclosure__icon">{icon}</span>}
        <span className="apx-disclosure__titles">
          <span className="apx-disclosure__title">{title}</span>
          {description && <span className="apx-disclosure__desc">{description}</span>}
        </span>
        {trailing && (
          // biome-ignore lint/a11y/noStaticElementInteractions: only keeps a click on the trailing control from toggling the row
          // biome-ignore lint/a11y/useKeyWithClickEvents: the controls inside handle their own keys
          <span className="apx-disclosure__trailing" onClick={(e) => e.preventDefault()}>
            {trailing}
          </span>
        )}
      </summary>
      <div className="apx-disclosure__body">{children}</div>
    </details>
  );
}

export interface DisclosureFactsProps {
  /** Label and value pairs; a pair with no value is left out. */
  rows: Array<[ReactNode, ReactNode]>;
}

/** Label and value lines inside a Disclosure, the label muted on the left (stacked on a narrow screen). */
export function DisclosureFacts({ rows }: DisclosureFactsProps) {
  return (
    <dl className="apx-disclosure__facts">
      {rows
        .filter(([, v]) => v !== undefined && v !== null && v !== "")
        .map(([k, v], n) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed order, never reordered
          <div key={n}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
    </dl>
  );
}
