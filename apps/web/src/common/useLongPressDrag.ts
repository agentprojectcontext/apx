import {
  type MouseEvent,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

const HOLD_MS = 300;
/** Moving this far before the hold ends is a scroll or a click, not a drag. */
const SLOP_PX = 6;

export type DragState<T> = { item: T; label: string; x: number; y: number; over: string | undefined };

/**
 * Press and hold an item to drag it; drop it on any element with `data-drop="<target>"`. A press that moves early
 * (a scroll) or lifts before the hold is an ordinary click. Escape cancels a drag.
 */
export function useLongPressDrag<T>(onDrop: (item: T, target: string) => void) {
  const [drag, setDrag] = useState<DragState<T>>();
  const pending = useRef<{ timer: ReturnType<typeof setTimeout>; x: number; y: number } | undefined>(undefined);
  const dragged = useRef(false);
  const dropRef = useRef(onDrop);
  dropRef.current = onDrop;

  const cancelHold = useCallback(() => {
    if (pending.current) clearTimeout(pending.current.timer);
    pending.current = undefined;
  }, []);

  // Listeners live while a drag does, not per pointer move.
  const active = drag != null;
  useEffect(() => {
    if (!active) return;
    const targetAt = (x: number, y: number) =>
      (document.elementFromPoint(x, y)?.closest("[data-drop]") as HTMLElement | null)?.dataset.drop;
    const move = (e: PointerEvent) =>
      setDrag((d) => (d ? { ...d, x: e.clientX, y: e.clientY, over: targetAt(e.clientX, e.clientY) } : d));
    const up = (e: PointerEvent) => {
      const target = targetAt(e.clientX, e.clientY);
      setDrag((d) => {
        if (d && target) dropRef.current(d.item, target);
        return undefined;
      });
    };
    const key = (e: KeyboardEvent) => e.key === "Escape" && setDrag(undefined);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up, { once: true });
    window.addEventListener("keydown", key);
    document.body.classList.add("is-dragging");
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("keydown", key);
      document.body.classList.remove("is-dragging");
    };
  }, [active]);

  /** Props for an item that can be dragged; `label` is what follows the pointer. */
  const bind = (item: T, label: string) => ({
    onPointerDown: (e: ReactPointerEvent) => {
      if (e.button !== 0) return;
      dragged.current = false;
      const { clientX: x, clientY: y } = e;
      cancelHold();
      pending.current = {
        x,
        y,
        timer: setTimeout(() => {
          pending.current = undefined;
          dragged.current = true;
          setDrag({ item, label, x, y, over: undefined });
        }, HOLD_MS),
      };
    },
    onPointerMove: (e: ReactPointerEvent) => {
      const p = pending.current;
      if (p && Math.hypot(e.clientX - p.x, e.clientY - p.y) > SLOP_PX) cancelHold();
    },
    onPointerUp: cancelHold,
    onPointerCancel: cancelHold,
    // The click that ends a drag is not a click on the item.
    onClickCapture: (e: MouseEvent) => {
      if (dragged.current) {
        e.preventDefault();
        e.stopPropagation();
        dragged.current = false;
      }
    },
  });

  return { drag, bind };
}
