/** The welcome film this panel shows once per device. A new film gets a new id, so it shows once again. */
export const WELCOME_FILM = "whats-new-2.14";

/** The film's scenes, each a slide: its strings' key and the seconds of the film it plays. */
export const WELCOME_SLIDES = [
  { key: "sidebar", start: 0, end: 8 },
  { key: "projects", start: 8.1, end: 18.3 },
  { key: "routines", start: 19.2, end: 29.6 },
  { key: "inbox", start: 30.6, end: 37.4 },
  { key: "channels", start: 38.4, end: 43.7 },
  { key: "signin", start: 44.7, end: 50.2 },
  { key: "apps", start: 51.2, end: 57.3 },
  { key: "flows", start: 58.3, end: 64.3 },
  { key: "gauges", start: 65.3, end: 70.8 },
  { key: "review", start: 71.3, end: 76.2 },
] as const;
