/** The welcome film this panel shows once per device. A new film gets a new id, so it shows once again. */
export const WELCOME_FILM = "whats-new-2.14.3";

/** One slide per section, in order; each plays its own clip from the docs site (media/whats-new/<lang>/<key>.mp4). */
export const WELCOME_SLIDES = [
  "sidebar",
  "projects",
  "routines",
  "inbox",
  "channels",
  "signin",
  "apps",
  "flows",
  "gauges",
  "review",
] as const;
