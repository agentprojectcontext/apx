import { useLayoutEffect, useRef } from "react";

/** The search's widest, and the widths from which it shows its word and then its shortcut. */
const SEARCH = { max: 320, icon: 30, word: 110, keys: 170 } as const;

/** What a row's visible children take, with its gaps and padding. */
function used(el: Element | null): number {
  if (!el) return 0;
  const style = getComputedStyle(el);
  const kids = [...el.children].map((c) => c.getBoundingClientRect().width).filter((w) => w > 0);
  const gap = Number.parseFloat(style.columnGap) || 0;
  return (
    kids.reduce((a, b) => a + b, 0) +
    gap * Math.max(0, kids.length - 1) +
    (Number.parseFloat(style.paddingLeft) || 0) +
    (Number.parseFloat(style.paddingRight) || 0)
  );
}

/**
 * The search, centred with the history arrows, takes what the two sides leave: its icon alone, then its word, then
 * its shortcut, up to its widest.
 */
function fitSearch(bar: HTMLElement): void {
  const center = bar.querySelector(".topbar__center");
  if (!center) return;
  const side = Math.max(used(bar.querySelector(".topbar__left")), used(bar.querySelector(".topbar__right")));
  const nav = bar.querySelector(".topbar__nav")?.getBoundingClientRect().width ?? 0;
  const gap = Number.parseFloat(getComputedStyle(bar).columnGap) || 0;
  const inner = Number.parseFloat(getComputedStyle(center).columnGap) || 0;
  const room = bar.clientWidth - 2 * (side + gap) - (nav ? nav + inner : 0);
  const width = Math.max(SEARCH.icon, Math.min(SEARCH.max, Math.floor(room)));
  bar.style.setProperty("--topbar-search-w", `${width}px`);
  bar.dataset.search = width >= SEARCH.keys ? "full" : width >= SEARCH.word ? "word" : "icon";
}

/** Measure the actual controls, including late quota reports and desktop window insets. */
export function useTopbarFit() {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const row = ref.current;
    if (!row) return;
    let frame = 0;
    const fit = () => {
      const bar = row.parentElement;
      // The sides settle with the search at its smallest; it then takes what they leave.
      bar?.style.setProperty("--topbar-search-w", `${SEARCH.icon}px`);
      const left = row.getBoundingClientRect().left;
      const minimum = Number(getComputedStyle(row).getPropertyValue("--topbar-min-fit")) || 0;
      for (let density = minimum; density <= 4; density++) {
        row.dataset.fit = String(density);
        if (
          ![...row.children].some((child) => {
            // Menu accessibility sentinels are not visible controls and must not change density on open.
            if (!child.matches("button, .topbar__activity, .topbar__usage")) return false;
            const bounds = child.getBoundingClientRect();
            return bounds.width > 0 && bounds.left < left;
          })
        )
          break;
      }
      if (bar) fitSearch(bar);
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(fit);
    };
    const sizes = new ResizeObserver(schedule);
    sizes.observe(row);
    if (row.parentElement) sizes.observe(row.parentElement);
    window.addEventListener("resize", schedule);
    for (const child of row.children) sizes.observe(child);
    const content = new MutationObserver(schedule);
    content.observe(row, { childList: true, characterData: true, subtree: true });
    fit();
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", schedule);
      sizes.disconnect();
      content.disconnect();
    };
  }, []);
  return ref;
}
