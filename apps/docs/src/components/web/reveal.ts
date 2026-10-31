// Blocks marked [data-reveal] rise in as they reach the screen. Only blocks still below the fold when the page opens
// start hidden, and after 4 s everything shows anyway, so a missed scroll never leaves a block out.
export function startReveal(): void {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const blocks = [...document.querySelectorAll<HTMLElement>("[data-reveal]")];
  for (const el of blocks) if (el.getBoundingClientRect().top > innerHeight) el.classList.add("is-below");
  let pending = false;
  const measure = () => {
    pending = false;
    for (const el of blocks)
      if (el.classList.contains("is-below") && el.getBoundingClientRect().top < innerHeight * 0.92)
        el.classList.remove("is-below");
  };
  const schedule = () => {
    if (pending) return;
    pending = true;
    requestAnimationFrame(measure);
  };
  addEventListener("scroll", schedule, { passive: true });
  addEventListener("resize", schedule);
  setTimeout(() => {
    for (const el of blocks) el.classList.remove("is-below");
  }, 4000);
}
