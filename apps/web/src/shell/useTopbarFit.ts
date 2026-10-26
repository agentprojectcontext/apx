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
      for (let density = 0; density <= 4; density++) {
        row.dataset.fit = String(density);
        if (
          ![...row.children].some((child) => {
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
    for (const child of row.children) sizes.observe(child);
    const content = new MutationObserver(schedule);
    content.observe(row, { childList: true, characterData: true, subtree: true });
    fit();
    return () => {
      cancelAnimationFrame(frame);
      sizes.disconnect();
      content.disconnect();
    };
  }, []);
  return ref;
}
