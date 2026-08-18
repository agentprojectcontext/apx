// Accent tones that read in BOTH themes.
//
// A bare `text-emerald-400` is a *dark-mode* colour: it was picked against a
// near-black ground. On a white card the same class is a pale smear — which is
// exactly how every engine badge, status chip and toggle looked in light mode.
//
// Every tone below ships as a light/dark pair: the light value is the ink-weight
// shade (600-800, measured to clear 4.5:1 on its own tint — the lightest hues
// need one step more), the dark value is the shade the app already used. Dark
// mode is therefore unchanged by construction — the old class is still there,
// just behind `dark:`.
//
// Use these instead of writing a colour class by hand. If a hue is missing, add
// it here rather than inlining a one-off.

export type Tone =
  | "emerald" | "green" | "lime" | "teal" | "cyan" | "sky" | "blue" | "indigo"
  | "violet" | "purple" | "pink" | "rose" | "red" | "orange" | "amber" | "slate";

/** Accent ink for text and icons on a plain surface. No background. */
export const toneText: Record<Tone, string> = {
  emerald: "text-emerald-700 dark:text-emerald-400",
  green:   "text-green-700 dark:text-green-400",
  lime:    "text-lime-700 dark:text-lime-400",
  teal:    "text-teal-700 dark:text-teal-400",
  cyan:    "text-cyan-700 dark:text-cyan-400",
  sky:     "text-sky-700 dark:text-sky-400",
  blue:    "text-blue-700 dark:text-blue-400",
  indigo:  "text-indigo-700 dark:text-indigo-400",
  violet:  "text-violet-700 dark:text-violet-400",
  purple:  "text-purple-700 dark:text-purple-400",
  pink:    "text-pink-700 dark:text-pink-400",
  rose:    "text-rose-700 dark:text-rose-400",
  red:     "text-red-700 dark:text-red-400",
  orange:  "text-orange-700 dark:text-orange-400",
  amber:   "text-amber-700 dark:text-amber-400",
  slate:   "text-slate-600 dark:text-slate-400",
};

/** Same ink, one step brighter — for hover targets and links. */
export const toneTextHover: Record<Tone, string> = {
  emerald: "hover:text-emerald-800 dark:hover:text-emerald-300",
  green:   "hover:text-green-800 dark:hover:text-green-300",
  lime:    "hover:text-lime-800 dark:hover:text-lime-300",
  teal:    "hover:text-teal-800 dark:hover:text-teal-300",
  cyan:    "hover:text-cyan-800 dark:hover:text-cyan-300",
  sky:     "hover:text-sky-800 dark:hover:text-sky-300",
  blue:    "hover:text-blue-800 dark:hover:text-blue-300",
  indigo:  "hover:text-indigo-800 dark:hover:text-indigo-300",
  violet:  "hover:text-violet-800 dark:hover:text-violet-300",
  purple:  "hover:text-purple-800 dark:hover:text-purple-300",
  pink:    "hover:text-pink-800 dark:hover:text-pink-300",
  rose:    "hover:text-rose-800 dark:hover:text-rose-300",
  red:     "hover:text-red-800 dark:hover:text-red-300",
  orange:  "hover:text-orange-800 dark:hover:text-orange-300",
  amber:   "hover:text-amber-800 dark:hover:text-amber-300",
  slate:   "hover:text-slate-700 dark:hover:text-slate-300",
};

/**
 * Filled chip / badge: tinted ground, visible edge, readable label. Carries its
 * own `border` width, so a call site only needs shape + padding classes.
 *
 * The light tint stays low (12%) on purpose: a white card is already bright, so
 * definition comes from the border and the ink, not from a louder fill. The ink
 * is one step darker than `toneText` for the same reason: it is measured against
 * the tint, not against the card, and chips carry the smallest type in the app.
 */
export const toneChip: Record<Tone, string> = {
  emerald: "border border-emerald-600/25 bg-emerald-500/12 text-emerald-800 dark:border-emerald-500/40 dark:bg-emerald-500/20 dark:text-emerald-300",
  green:   "border border-green-600/25 bg-green-500/12 text-green-800 dark:border-green-500/40 dark:bg-green-500/20 dark:text-green-300",
  lime:    "border border-lime-600/25 bg-lime-500/12 text-lime-800 dark:border-lime-500/40 dark:bg-lime-500/20 dark:text-lime-300",
  teal:    "border border-teal-600/25 bg-teal-500/12 text-teal-800 dark:border-teal-500/40 dark:bg-teal-500/20 dark:text-teal-300",
  cyan:    "border border-cyan-600/25 bg-cyan-500/12 text-cyan-800 dark:border-cyan-500/40 dark:bg-cyan-500/20 dark:text-cyan-300",
  sky:     "border border-sky-600/25 bg-sky-500/12 text-sky-800 dark:border-sky-500/40 dark:bg-sky-500/20 dark:text-sky-300",
  blue:    "border border-blue-600/25 bg-blue-500/12 text-blue-800 dark:border-blue-500/40 dark:bg-blue-500/20 dark:text-blue-300",
  indigo:  "border border-indigo-600/25 bg-indigo-500/12 text-indigo-800 dark:border-indigo-500/40 dark:bg-indigo-500/20 dark:text-indigo-300",
  violet:  "border border-violet-600/25 bg-violet-500/12 text-violet-800 dark:border-violet-500/40 dark:bg-violet-500/20 dark:text-violet-300",
  purple:  "border border-purple-600/25 bg-purple-500/12 text-purple-800 dark:border-purple-500/40 dark:bg-purple-500/20 dark:text-purple-300",
  pink:    "border border-pink-600/25 bg-pink-500/12 text-pink-800 dark:border-pink-500/40 dark:bg-pink-500/20 dark:text-pink-300",
  rose:    "border border-rose-600/25 bg-rose-500/12 text-rose-800 dark:border-rose-500/40 dark:bg-rose-500/20 dark:text-rose-300",
  red:     "border border-red-600/25 bg-red-500/12 text-red-800 dark:border-red-500/40 dark:bg-red-500/20 dark:text-red-300",
  orange:  "border border-orange-600/25 bg-orange-500/12 text-orange-800 dark:border-orange-500/40 dark:bg-orange-500/20 dark:text-orange-300",
  amber:   "border border-amber-600/25 bg-amber-500/12 text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/20 dark:text-amber-300",
  slate:   "border border-slate-500/25 bg-slate-500/12 text-slate-800 dark:border-slate-500/40 dark:bg-slate-500/20 dark:text-slate-300",
};

/**
 * "This one is picked" outline: accent edge, barely-there fill, accent ink.
 * Used by the toggle pills (active provider, schedule presets, skill chips).
 * Carries its own `border` width.
 */
export const toneOutline: Record<Tone, string> = {
  emerald: "border border-emerald-600/40 bg-emerald-500/8 text-emerald-700 dark:border-emerald-500/50 dark:bg-emerald-500/10 dark:text-emerald-400",
  green:   "border border-green-600/40 bg-green-500/8 text-green-700 dark:border-green-500/50 dark:bg-green-500/10 dark:text-green-400",
  lime:    "border border-lime-600/40 bg-lime-500/8 text-lime-700 dark:border-lime-500/50 dark:bg-lime-500/10 dark:text-lime-400",
  teal:    "border border-teal-600/40 bg-teal-500/8 text-teal-700 dark:border-teal-500/50 dark:bg-teal-500/10 dark:text-teal-400",
  cyan:    "border border-cyan-600/40 bg-cyan-500/8 text-cyan-700 dark:border-cyan-500/50 dark:bg-cyan-500/10 dark:text-cyan-400",
  sky:     "border border-sky-600/40 bg-sky-500/8 text-sky-700 dark:border-sky-500/50 dark:bg-sky-500/10 dark:text-sky-400",
  blue:    "border border-blue-600/40 bg-blue-500/8 text-blue-700 dark:border-blue-500/50 dark:bg-blue-500/10 dark:text-blue-400",
  indigo:  "border border-indigo-600/40 bg-indigo-500/8 text-indigo-700 dark:border-indigo-500/50 dark:bg-indigo-500/10 dark:text-indigo-400",
  violet:  "border border-violet-600/40 bg-violet-500/8 text-violet-700 dark:border-violet-500/50 dark:bg-violet-500/10 dark:text-violet-400",
  purple:  "border border-purple-600/40 bg-purple-500/8 text-purple-700 dark:border-purple-500/50 dark:bg-purple-500/10 dark:text-purple-400",
  pink:    "border border-pink-600/40 bg-pink-500/8 text-pink-700 dark:border-pink-500/50 dark:bg-pink-500/10 dark:text-pink-400",
  rose:    "border border-rose-600/40 bg-rose-500/8 text-rose-700 dark:border-rose-500/50 dark:bg-rose-500/10 dark:text-rose-400",
  red:     "border border-red-600/40 bg-red-500/8 text-red-700 dark:border-red-500/50 dark:bg-red-500/10 dark:text-red-400",
  orange:  "border border-orange-600/40 bg-orange-500/8 text-orange-700 dark:border-orange-500/50 dark:bg-orange-500/10 dark:text-orange-400",
  amber:   "border border-amber-600/40 bg-amber-500/8 text-amber-700 dark:border-amber-500/50 dark:bg-amber-500/10 dark:text-amber-400",
  slate:   "border border-slate-500/40 bg-slate-500/8 text-slate-700 dark:border-slate-500/50 dark:bg-slate-500/10 dark:text-slate-400",
};

/** Square icon-holder behind a status glyph: soft tint + accent ink, no edge. */
export const toneTint: Record<Tone, string> = {
  emerald: "bg-emerald-500/12 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400",
  green:   "bg-green-500/12 text-green-700 dark:bg-green-500/15 dark:text-green-400",
  lime:    "bg-lime-500/12 text-lime-700 dark:bg-lime-500/15 dark:text-lime-400",
  teal:    "bg-teal-500/12 text-teal-700 dark:bg-teal-500/15 dark:text-teal-400",
  cyan:    "bg-cyan-500/12 text-cyan-700 dark:bg-cyan-500/15 dark:text-cyan-400",
  sky:     "bg-sky-500/12 text-sky-700 dark:bg-sky-500/15 dark:text-sky-400",
  blue:    "bg-blue-500/12 text-blue-700 dark:bg-blue-500/15 dark:text-blue-400",
  indigo:  "bg-indigo-500/12 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-400",
  violet:  "bg-violet-500/12 text-violet-700 dark:bg-violet-500/15 dark:text-violet-400",
  purple:  "bg-purple-500/12 text-purple-700 dark:bg-purple-500/15 dark:text-purple-400",
  pink:    "bg-pink-500/12 text-pink-700 dark:bg-pink-500/15 dark:text-pink-400",
  rose:    "bg-rose-500/12 text-rose-700 dark:bg-rose-500/15 dark:text-rose-400",
  red:     "bg-red-500/12 text-red-700 dark:bg-red-500/15 dark:text-red-400",
  orange:  "bg-orange-500/12 text-orange-700 dark:bg-orange-500/15 dark:text-orange-400",
  amber:   "bg-amber-500/12 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400",
  slate:   "bg-slate-500/12 text-slate-700 dark:bg-slate-500/15 dark:text-slate-400",
};

/** Solid dot / bullet fill. Small and opaque, so it needs weight in light. */
export const toneDot: Record<Tone, string> = {
  emerald: "bg-emerald-600 dark:bg-emerald-400",
  green:   "bg-green-600 dark:bg-green-400",
  lime:    "bg-lime-600 dark:bg-lime-400",
  teal:    "bg-teal-600 dark:bg-teal-400",
  cyan:    "bg-cyan-600 dark:bg-cyan-400",
  sky:     "bg-sky-600 dark:bg-sky-400",
  blue:    "bg-blue-600 dark:bg-blue-400",
  indigo:  "bg-indigo-600 dark:bg-indigo-400",
  violet:  "bg-violet-600 dark:bg-violet-400",
  purple:  "bg-purple-600 dark:bg-purple-400",
  pink:    "bg-pink-600 dark:bg-pink-400",
  rose:    "bg-rose-600 dark:bg-rose-400",
  red:     "bg-red-600 dark:bg-red-400",
  orange:  "bg-orange-600 dark:bg-orange-400",
  amber:   "bg-amber-600 dark:bg-amber-400",
  slate:   "bg-slate-500 dark:bg-slate-400",
};
