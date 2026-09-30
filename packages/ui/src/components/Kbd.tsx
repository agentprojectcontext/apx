import type { HTMLAttributes } from "react";
import { cx } from "../cx";

export interface KbdProps extends HTMLAttributes<HTMLElement> {
  /** Keys to show, e.g. ["⌘", "K"]. Alternatively pass children. */
  keys?: string[];
}

/** Keyboard shortcut hint: ⌘K, ⇧⏎. */
export function Kbd({ keys, className, children, ...rest }: KbdProps) {
  return (
    <kbd className={cx("apx-kbd", className)} {...rest}>
      {keys ? keys.map((k, i) => <span key={i}>{k}</span>) : children}
    </kbd>
  );
}
