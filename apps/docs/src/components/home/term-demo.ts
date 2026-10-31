// The terminal demo plays its commands in turn: each one typed, then its output line by line, a pause, the next;
// after the last the screen clears and it starts again. It waits while off screen or in a hidden tab, keeps the
// height of its longest screen, and stays on the first command (already in the page) when motion is reduced.
type Line = [string, string];
type Step = { command: string; output: Line[] };

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function line([kind, text]: Line): HTMLElement | Text {
  if (kind === "#" || kind === "✓") {
    const span = document.createElement("span");
    span.className = kind === "#" ? "term-demo__muted" : "term-demo__ok";
    span.textContent = `${kind} ${text}`;
    return span;
  }
  return document.createTextNode(kind ? `${kind} ${text}` : text);
}

function render(code: HTMLElement, step: Step, typed = step.command, lines = step.output.length, cursor = false) {
  code.replaceChildren();
  const prompt = document.createElement("span");
  prompt.className = "term-demo__prompt";
  prompt.textContent = "$";
  code.append(prompt, ` ${typed}`);
  if (cursor) {
    const caret = document.createElement("span");
    caret.className = "term-demo__caret";
    code.append(caret);
  }
  for (const out of step.output.slice(0, lines)) code.append("\n", line(out));
}

export function startTermDemo(screen: HTMLElement): void {
  const steps = JSON.parse(screen.dataset.demo ?? "[]") as Step[];
  const code = screen.querySelector("code");
  if (!code || steps.length < 2 || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  // Hold the height of the tallest screen, so nothing below moves.
  const fit = () => {
    screen.style.minHeight = "";
    let tallest = 0;
    for (const step of steps) {
      render(code, step, step.command, step.output.length, true);
      tallest = Math.max(tallest, screen.offsetHeight);
    }
    screen.style.minHeight = `${tallest}px`;
  };
  fit();
  void document.fonts?.ready.then(fit);
  addEventListener("resize", fit);
  let visible = false;
  new IntersectionObserver(([entry]) => {
    visible = Boolean(entry?.isIntersecting);
  }).observe(screen);
  const ready = async () => {
    while (!visible || document.hidden) await wait(250);
  };
  void (async () => {
    for (let i = 0; ; i = (i + 1) % steps.length) {
      const step = steps[i] as Step;
      await ready();
      for (let n = 0; n <= step.command.length; n++) {
        render(code, step, step.command.slice(0, n), 0, true);
        await wait(n === 0 ? 500 : 38 + Math.random() * 40);
        await ready();
      }
      await wait(350);
      for (let n = 1; n <= step.output.length; n++) {
        render(code, step, step.command, n, n === step.output.length);
        await wait(200);
      }
      await wait(2600);
    }
  })();
}
