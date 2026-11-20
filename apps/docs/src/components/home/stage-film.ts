// The hero's card plays the panel's video (scripts/hero-film.ts) over its poster. The poster comes in blurred and sharpens
// once loaded; the video loads only when the card is on screen, pauses off screen, follows the page's theme, and never
// plays for readers who ask for less motion. One dot per chapter: the playing one fills, a click jumps to its start,
// and a click on the playing one pauses or resumes.

export function startStageFilm(card: HTMLElement, dots: HTMLElement | null, still: boolean) {
  const video = card.querySelector<HTMLVideoElement>("video");
  const posters = [...card.querySelectorAll<HTMLImageElement>("img")];
  const sharpen = () => {
    if (posters.some((img) => img.offsetParent && img.complete && img.naturalWidth)) card.classList.add("is-sharp");
  };
  for (const img of posters) img.addEventListener("load", sharpen);
  sharpen();
  if (!video || still) return;

  const buttons = [...(dots?.querySelectorAll<HTMLButtonElement>("button[data-at]") ?? [])];
  const starts = buttons.map((b) => Number(b.dataset.at));
  const theme = () => (document.documentElement.dataset.theme === "dark" ? "dark" : "light");
  let onScreen = false;
  let held = false;
  let frame = 0;
  const play = () => {
    if (onScreen && !held) void video.play().catch(() => {});
  };

  const load = () => {
    const src = video.dataset[theme()];
    if (!src || video.getAttribute("src") === src) return;
    const at = video.currentTime;
    const playing = !video.paused;
    video.preload = "auto";
    video.src = src;
    if (at) video.addEventListener("loadedmetadata", () => (video.currentTime = at), { once: true });
    if (playing) play();
  };
  const mark = () => {
    const t = video.currentTime;
    const length = Number.isFinite(video.duration) ? video.duration : (starts.at(-1) ?? 0);
    let on = 0;
    for (let i = 0; i < starts.length; i++) if (t >= starts[i]) on = i;
    buttons.forEach((b, i) => {
      b.setAttribute("aria-pressed", String(i === on));
      const end = starts[i + 1] ?? length;
      const p = i < on ? 0 : i === on ? Math.min(1, Math.max(0, (t - starts[i]) / (end - starts[i] || 1))) : 0;
      b.style.setProperty("--p", p.toFixed(3));
    });
  };
  const tick = () => {
    mark();
    frame = video.paused ? 0 : requestAnimationFrame(tick);
  };

  video.addEventListener("playing", () => {
    card.classList.add("is-playing");
    if (dots) dots.hidden = false;
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(tick);
  });
  // A first play() can be refused while the page is still settling: try again once there is something to show.
  video.addEventListener("canplay", () => {
    if (video.paused) play();
  });
  video.addEventListener("pause", mark);
  video.addEventListener("seeked", mark);

  buttons.forEach((b, i) => {
    b.addEventListener("click", () => {
      if (b.getAttribute("aria-pressed") === "true" && !video.paused) {
        held = true;
        video.pause();
        return;
      }
      held = false;
      if (b.getAttribute("aria-pressed") !== "true") video.currentTime = starts[i];
      mark();
      play();
    });
  });

  new IntersectionObserver(
    ([entry]) => {
      onScreen = entry.isIntersecting;
      if (onScreen) {
        load();
        play();
      } else video.pause();
    },
    { threshold: 0.2 },
  ).observe(card);

  // The theme switch swaps in the other take at the same moment.
  new MutationObserver(() => {
    if (video.getAttribute("src")) load();
  }).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
}
