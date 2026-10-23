import { CircleHelp } from "lucide-react";
import type { ReactNode } from "react";
import { cx } from "../cx";
import { Popover } from "./Popover";

export interface HelpItem {
  term: ReactNode;
  text: ReactNode;
}

export interface HelpProps {
  /** Accessible name of the "?" button and of the panel ("About columns"). */
  label: string;
  title?: ReactNode;
  /** One line per option: what it is and when to use it. */
  items?: HelpItem[];
  children?: ReactNode;
  align?: "start" | "center" | "end";
  width?: number;
  className?: string;
}

/**
 * A "?" after a title that opens a short explanation (when to use each option) on hover or click. Unlike a tooltip the
 * pointer can move onto it to read it; it closes on leaving, a second click, an outside click or Escape.
 */
export function Help({ label, title, items, children, align = "start", width = 320, className }: HelpProps) {
  return (
    <Popover
      align={align}
      width={width}
      label={label}
      className="apx-help__panel"
      openOnHover
      trigger={
        <button type="button" className={cx("apx-help", className)} aria-label={label}>
          <CircleHelp size={13} />
        </button>
      }
    >
      {title && <div className="apx-help__title">{title}</div>}
      {items && items.length > 0 && (
        <dl className="apx-help__items">
          {items.map((item, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: a fixed list given by the caller
            <div key={i} className="apx-help__item">
              <dt>{item.term}</dt>
              <dd>{item.text}</dd>
            </div>
          ))}
        </dl>
      )}
      {children && <div className="apx-help__body">{children}</div>}
    </Popover>
  );
}
