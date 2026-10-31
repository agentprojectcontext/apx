// A comparison's reading progress. Wide screens get a rail on the right: one segment per section, filling as the
// reader goes, with Menta at the tip; it shows once the short answer is well on screen and leaves after the last
// section. Narrower screens get a thin line under the header and a chip with the current section.
export function startReading(): void {
  const sections = [...document.querySelectorAll<HTMLElement>("[data-sec]")];
  const rail = document.querySelector<HTMLElement>(".reading-rail");
  const chip = document.querySelector<HTMLElement>(".reading-chip");
  if (!sections.length || !rail || !chip) return;
  const links = [...document.querySelectorAll<HTMLAnchorElement>("a[data-section]")];
  const segs = [...rail.querySelectorAll<HTMLElement>(".reading-rail__seg")];
  const chipN = chip.querySelector<HTMLElement>("[data-chip-n]");
  const chipLabel = chip.querySelector<HTMLElement>("[data-chip-label]");
  const details = chip.querySelector("details");
  const labelEls = [...rail.querySelectorAll<HTMLElement>(".reading-rail__label")];
  const labels = labelEls.map((l) => l.textContent ?? "");
  // The panel behind the labels is as wide as the longest one.
  const panel = rail.querySelector<HTMLElement>(".reading-rail__panel");
  const fit = () =>
    panel?.style.setProperty("--panel-w", `${Math.max(0, ...labelEls.map((l) => l.offsetWidth)) + 28}px`);
  void document.fonts?.ready.then(fit);
  fit();
  for (const link of links) link.addEventListener("click", () => details?.removeAttribute("open"));

  let pending = false;
  const measure = () => {
    pending = false;
    const vh = innerHeight;
    const max = document.documentElement.scrollHeight - vh;
    const page = max > 0 ? Math.min(1, Math.max(0, scrollY / max)) : 0;
    const line = vh * 0.35;
    let active = 0;
    sections.forEach((s, i) => {
      if (s.getBoundingClientRect().top <= line) active = i;
    });
    const box = sections[active]?.getBoundingClientRect();
    const inside = box ? Math.min(1, Math.max(0, (line - box.top) / box.height)) : 0;
    let progress = Math.min(1, (active + inside) / sections.length);
    if (page > 0.985) {
      active = sections.length - 1;
      progress = 1;
    }
    const first = sections[0]?.getBoundingClientRect();
    const last = sections[sections.length - 1]?.getBoundingClientRect();
    const gone = Boolean(first && last && (last.bottom < vh * 0.45 || first.top > vh * 0.6));
    rail.toggleAttribute("data-gone", gone);
    rail.style.setProperty("--rail-p", progress.toFixed(4));
    segs.forEach((seg, i) => {
      seg.style.setProperty("--fill", String(Math.min(1, Math.max(0, progress * segs.length - i))));
    });
    chip.style.setProperty("--page-p", page.toFixed(4));
    const id = sections[active]?.id;
    for (const link of links) {
      if (link.dataset.section === id) link.setAttribute("aria-current", "location");
      else link.removeAttribute("aria-current");
    }
    if (chipN) chipN.textContent = `${active + 1}/${sections.length}`;
    if (chipLabel) chipLabel.textContent = labels[active] ?? "";
  };
  const schedule = () => {
    if (pending) return;
    pending = true;
    requestAnimationFrame(measure);
  };
  addEventListener("scroll", schedule, { passive: true });
  addEventListener("resize", schedule);
  addEventListener("load", schedule);
  measure();
}
