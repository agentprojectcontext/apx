import "../styles/title-tips.css";
import { useEffect, useRef, useState } from "react";

/** Controls whose `title` is their hint: buttons, links, tabs and menu items. */
const TARGET = [
  "button[title]",
  "a[title]",
  '[role="button"][title]',
  '[role="tab"][title]',
  '[role="menuitem"][title]',
  "button[data-apx-title]",
  "a[data-apx-title]",
  '[role="button"][data-apx-title]',
  '[role="tab"][data-apx-title]',
  '[role="menuitem"][data-apx-title]',
].join(",");

const DELAY = 400;
const GAP = 6;
const EDGE = 8;

type Tip = { text: string; x: number; y: number; above: boolean };

/**
 * Every control with a `title` shows it as the design system's tooltip instead of the browser's: the title moves to
 * `data-apx-title` (and to the accessible name or description) the first time the control is pointed at or focused.
 */
export function TitleTooltips() {
  const [tip, setTip] = useState<Tip>();
  const box = useRef<HTMLDivElement>(null);
  const [left, setLeft] = useState(0);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let current: Element | undefined;
    const hide = () => {
      clearTimeout(timer);
      current = undefined;
      setTip(undefined);
    };
    const adopt = (el: Element): string => {
      const title = el.getAttribute("title");
      if (title) {
        el.setAttribute("data-apx-title", title);
        el.removeAttribute("title");
        if (!el.getAttribute("aria-label") && !el.textContent?.trim()) el.setAttribute("aria-label", title);
        else if (el.getAttribute("aria-label") !== title) el.setAttribute("aria-description", title);
      }
      return el.getAttribute("data-apx-title") ?? "";
    };
    const show = (el: Element, now = false) => {
      const text = adopt(el);
      if (!text || el === current) return;
      clearTimeout(timer);
      current = el;
      timer = setTimeout(
        () => {
          if (current !== el || !el.isConnected) return;
          const r = el.getBoundingClientRect();
          const above = r.bottom + 40 > window.innerHeight;
          setTip({ text, x: r.left + r.width / 2, y: above ? r.top - GAP : r.bottom + GAP, above });
        },
        now ? 0 : DELAY,
      );
    };
    const over = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      const el = (e.target as Element | null)?.closest?.(TARGET);
      if (el) show(el);
      else if (current) hide();
    };
    const focus = (e: FocusEvent) => {
      const el = (e.target as Element | null)?.closest?.(TARGET);
      if (el?.matches(":focus-visible")) show(el, true);
    };
    document.addEventListener("pointerover", over, true);
    document.addEventListener("focusin", focus, true);
    document.addEventListener("focusout", hide, true);
    document.addEventListener("pointerdown", hide, true);
    document.addEventListener("keydown", hide, true);
    window.addEventListener("scroll", hide, true);
    window.addEventListener("blur", hide);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("pointerover", over, true);
      document.removeEventListener("focusin", focus, true);
      document.removeEventListener("focusout", hide, true);
      document.removeEventListener("pointerdown", hide, true);
      document.removeEventListener("keydown", hide, true);
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("blur", hide);
    };
  }, []);
  // Keeps the tip on screen once its width is known.
  useEffect(() => {
    const w = box.current?.offsetWidth ?? 0;
    if (tip) setLeft(Math.min(Math.max(EDGE, tip.x - w / 2), window.innerWidth - w - EDGE));
  }, [tip]);
  if (!tip) return null;
  return (
    <div
      ref={box}
      className="apx-tooltip titletip"
      role="presentation"
      style={{ left, top: tip.y, transform: tip.above ? "translateY(-100%)" : undefined }}
    >
      {tip.text}
    </div>
  );
}
