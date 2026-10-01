import { isValidElement, type ReactNode } from "react";

/**
 * Pairs items that carry no id with keys built from their text plus an occurrence count, so keys stay
 * unique and an insertion elsewhere in the list does not shift them (unlike index keys).
 */
export function keyed<T>(items: readonly T[], text: (item: T) => ReactNode): { item: T; key: string }[] {
  const seen = new Map<string, number>();
  return items.map((item) => {
    const t = text(item);
    let base = "";
    if (typeof t === "string" || typeof t === "number") base = String(t);
    else if (isValidElement(t) && t.key != null) base = `#${t.key}`;
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return { item, key: `${base}:${n}` };
  });
}
