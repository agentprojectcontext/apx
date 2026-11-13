/**
 * What's new, newest first: one slide per feature, each playing its own clip from the docs site
 * (media/whats-new/<lang>/<key>.mp4), with the first release that has it. A new feature goes at the top.
 */
export const WELCOME_SLIDES = [
  { key: "groups", since: "2.14.4" },
  { key: "group-answers", since: "2.14.4" },
  { key: "group-card", since: "2.14.4" },
  { key: "sidebar", since: "2.14.0" },
  { key: "projects", since: "2.14.0" },
  { key: "routines", since: "2.14.0" },
  { key: "inbox", since: "2.14.0" },
  { key: "channels", since: "2.14.0" },
  { key: "signin", since: "2.14.0" },
  { key: "apps", since: "2.14.0" },
  { key: "flows", since: "2.14.0" },
  { key: "gauges", since: "2.14.0" },
  { key: "review", since: "2.14.0" },
] as const;

export type WelcomeSlide = (typeof WELCOME_SLIDES)[number];
export type SlideKey = WelcomeSlide["key"];

/** Every slide's key: what a device that has seen them all keeps (the e2e kits start from it). */
export const ALL_SLIDES: readonly string[] = WELCOME_SLIDES.map((s) => s.key);

/** A slide is news for this many minor releases: one from 2.14.x stops showing at 2.16.0. */
const MINORS_KEPT = 2;

/**
 * What the welcome shows on this device: the slides it has not seen yet, still news for the running version. A build
 * that is not a release (a checkout's, `0.0.0`) shows every slide not seen.
 */
export function slidesToShow(version: string, seen: readonly string[]): WelcomeSlide[] {
  const now = minorOf(version);
  return WELCOME_SLIDES.filter((s) => {
    if (seen.includes(s.key)) return false;
    const since = minorOf(s.since);
    if (!now || !since) return true;
    return now[0] === since[0] ? now[1] - since[1] < MINORS_KEPT : now[0] < since[0];
  });
}

function minorOf(v: string): [number, number] | undefined {
  const m = /^(\d+)\.(\d+)\.\d+/.exec(v);
  if (!m || v.startsWith("0.0.0")) return undefined;
  return [Number(m[1]), Number(m[2])];
}

/**
 * What a device that closed the single-id welcome had seen. Goes with the 2.14.0 slides when they expire (2.16.0).
 * See HISTORY.md#welcome-slides-seen.
 */
export function seenBefore(film: unknown): string[] {
  return film === "whats-new-2.14.3" ? WELCOME_SLIDES.filter((s) => s.since === "2.14.0").map((s) => s.key) : [];
}
