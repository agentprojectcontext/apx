import { IconButton, Icons } from "@apx/ui";
import { createContext, type ReactNode, type RefObject, useContext, useLayoutEffect, useRef, useState } from "react";

/** A chat row's nested sessions, shown or not: a row that draws its own chevron reads this. */
export type Fold = { open: boolean; toggle(): void; label: string };

export const FoldContext = createContext<Fold | undefined>(undefined);

type At = { left: number; top: number };

/**
 * The chevron that folds a row's nested sessions, right after its title. The row is one button, so the chevron is not
 * inside it: the row leaves `slot` in its title line and `button` (beside the row, inside `wrap`) sits over it.
 */
export function useRowFold(): {
  fold: Fold | undefined;
  wrap: RefObject<HTMLDivElement | null>;
  slot: ReactNode;
  button: ReactNode;
} {
  const fold = useContext(FoldContext);
  const wrap = useRef<HTMLDivElement>(null);
  const mark = useRef<HTMLSpanElement>(null);
  const [at, setAt] = useState<At>();
  const on = Boolean(fold);
  useLayoutEffect(() => {
    const box = wrap.current;
    const spot = mark.current;
    if (!on || !box || !spot) return;
    const place = () => {
      const a = box.getBoundingClientRect();
      const b = spot.getBoundingClientRect();
      const next = { left: Math.round(b.left - a.left), top: Math.round(b.top - a.top) };
      setAt((prev) => (prev && prev.left === next.left && prev.top === next.top ? prev : next));
    };
    place();
    // The title before the slot grows, shrinks and truncates with its text, weight and the list's width.
    const watch = new ResizeObserver(place);
    watch.observe(box);
    const title = spot.parentElement?.querySelector(".apx-convrow__title");
    if (title) watch.observe(title);
    return () => watch.disconnect();
  }, [on]);
  if (!fold) return { fold, wrap, slot: null, button: null };
  return {
    fold,
    wrap,
    slot: <span ref={mark} className="rowfold__slot" aria-hidden="true" />,
    button: (
      <IconButton
        size="sm"
        shape="circle"
        className={`rowfold${fold.open ? " is-open" : ""}`}
        style={at ? { left: at.left, top: at.top } : { visibility: "hidden" }}
        label={fold.label}
        aria-expanded={fold.open}
        icon={<Icons.ChevronDown size={12} />}
        onClick={fold.toggle}
      />
    ),
  };
}
