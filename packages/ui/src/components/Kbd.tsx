import type { HTMLAttributes } from "react";
import { cx } from "../cx";
import { keyed } from "../keys";

export interface KbdProps extends HTMLAttributes<HTMLElement> {
  /** Keys to show, e.g. ["⌘", "K"]. Alternatively pass children. */
  keys?: string[];
}

/** Keyboard shortcut hint: ⌘K, ⇧⏎. */
export function Kbd({ keys, className, children, ...rest }: KbdProps) {
  return (
    <kbd className={cx("apx-kbd", className)} {...rest}>
      {keys ? keyed(keys, (k) => k).map(({ item: k, key }) => <span key={key}>{k}</span>) : children}
    </kbd>
  );
}
