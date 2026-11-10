// Google Calendar events the owner asked not to be reminded of: a recurring one by its series (every later
// occurrence too), a single one by its id. Kept in the "calendar_muted" setting; the reminders skip them before any
// notice or message exists, so a muted event never reaches the owner or an agent.
import type { Store } from "./store.ts";

/** How many are kept: past it the oldest goes (the setting's schema refuses a longer list). */
const MUTED_MAX = 500;

/** What muting an event silences: its whole series, or the event alone. */
export const seriesOf = (e: { id: string; series?: string | undefined }) => e.series || e.id;
/** A reminder notice names the series it is about, so the owner can mute it from there. */
export const eventRef = (series: string) => `event:${series}`;

/** The series the owner muted. */
export function mutedSeries(store: Store): Set<string> {
  return new Set(store.settings.read("calendar_muted").map((m) => m.series));
}

/** Mutes or unmutes a series; a muted one's open notice leaves the tray. What stays muted, the latest last. */
export function setMuted(store: Store, o: { series: string; title?: string | undefined; muted: boolean }, at: Date) {
  const all = store.settings.read("calendar_muted");
  const kept = all.filter((m) => m.series !== o.series);
  const title = o.title ?? all.find((m) => m.series === o.series)?.title ?? "";
  const next = o.muted ? [...kept, { series: o.series, title, at: at.toISOString() }].slice(-MUTED_MAX) : kept;
  store.settings.write("calendar_muted", next);
  if (o.muted) store.notifications.resolve("due", eventRef(o.series));
  return next;
}
