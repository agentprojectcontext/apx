// Each section's agent types its label once the bubble is 30% up the screen, and unwrites it when the section leaves,
// so it types again on the way back, scrolling up or down. The full label stays readable for screen readers.
export function startSecSay(): void {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  for (const bubble of document.querySelectorAll<HTMLElement>(".sec-say__bubble")) {
    const typed = bubble.querySelector<HTMLElement>(".sec-say__typed");
    if (!typed) continue;
    const text = typed.textContent ?? "";
    let shown = 0;
    let target = 0;
    let timer = 0;
    const step = () => {
      shown += Math.sign(target - shown);
      typed.textContent = text.slice(0, shown);
      bubble.classList.toggle("is-empty", shown === 0);
      bubble.classList.toggle("is-typing", shown !== target);
      if (shown !== target) timer = window.setTimeout(step, target > shown ? 45 : 18);
    };
    const go = (to: number) => {
      target = to;
      clearTimeout(timer);
      // A short pause with the dots before the first letter, as if the agent were thinking.
      timer = window.setTimeout(step, to > shown && shown === 0 ? 450 : 0);
      if (to > shown) bubble.classList.add("is-typing");
    };
    typed.textContent = "";
    bubble.classList.add("is-empty");
    new IntersectionObserver(([entry]) => go(entry?.isIntersecting ? text.length : 0), {
      rootMargin: "0px 0px -30% 0px",
    }).observe(bubble);
  }
}
