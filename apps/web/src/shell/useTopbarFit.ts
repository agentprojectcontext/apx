import { useLayoutEffect, useRef } from "react";

/** Measure the actual controls, including late quota reports and desktop window insets. */
export function useTopbarFit() {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const row = ref.current;
    if (!row) return;
    let frame = 0;
    const fit = () => {
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
