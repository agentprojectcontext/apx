// Where the call card sits: dragged by its head anywhere on screen, kept inside it, remembered on this device.
import { type PointerEvent as ReactPointerEvent, useCallback, useEffect, useState } from "react";

const KEY = "apx.callCardPlace";
const MARGIN = 8;

type Place = { x: number; y: number };

function read(): Place | undefined {
  try {
    const p = JSON.parse(window.localStorage.getItem(KEY) ?? "null") as Place | null;
    return p && Number.isFinite(p.x) && Number.isFinite(p.y) ? p : undefined;
  } catch {
    return undefined;
  }
}

function write(p: Place): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(p));
  } catch {}
}

/** Keeps a card of this size on screen. */
function inside(p: Place, w: number, h: number): Place {
  return {
    x: Math.min(Math.max(MARGIN, p.x), Math.max(MARGIN, window.innerWidth - w - MARGIN)),
    y: Math.min(Math.max(MARGIN, p.y), Math.max(MARGIN, window.innerHeight - h - MARGIN)),
  };
}

/**
 * The card's place (undefined: where the stylesheet puts it) and the pointer handler for its head. A press on a button
 * inside the head stays a press.
 */
export function useCardPlace(card: React.RefObject<HTMLElement | null>) {
  const [place, setPlace] = useState<Place | undefined>(read);

  // A smaller window keeps the card in view.
  useEffect(() => {
    const fit = () => {
      const el = card.current;
      if (el) setPlace((p) => (p ? inside(p, el.offsetWidth, el.offsetHeight) : p));
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [card]);

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      const el = card.current;
      if (!el || e.button !== 0 || (e.target as HTMLElement).closest("button")) return;
      const box = el.getBoundingClientRect();
      const dx = e.clientX - box.left;
      const dy = e.clientY - box.top;
      const head = e.currentTarget;
      head.setPointerCapture(e.pointerId);
      let last: Place | undefined;
      const move = (ev: PointerEvent) => {
        last = inside({ x: ev.clientX - dx, y: ev.clientY - dy }, box.width, el.offsetHeight);
        setPlace(last);
      };
      const up = () => {
        head.removeEventListener("pointermove", move);
        head.removeEventListener("pointerup", up);
        head.removeEventListener("pointercancel", up);
        if (last) write(last);
      };
      head.addEventListener("pointermove", move);
      head.addEventListener("pointerup", up);
      head.addEventListener("pointercancel", up);
    },
    [card],
  );

  const style = place ? { left: place.x, top: place.y, right: "auto" } : undefined;
  return { style, onPointerDown };
}
