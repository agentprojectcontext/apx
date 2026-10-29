// Event reminders: the owner's Google Calendar events that start within the lead time they chose in Calendar's
// settings are told once, in a fixed line (no model call, so an event's text never reaches an agent).

import { channelTexts } from "../channels/texts.ts";
import { ownerTimeZone } from "../domain/owner.ts";
import type { Store } from "../domain/store.ts";
import type { BackgroundCheck } from "./background.ts";

/** An event as the reminders see it. */
export type CalendarEvent = {
  id: string;
  title: string;
  start: string | undefined;
  all_day: boolean;
  location?: string;
  meet?: string;
  status?: string;
  /** The owner said they will not go. */
  declined?: boolean;
};

/** The owner's Google Calendar; `readable` is false while it is not connected. */
export type CalendarSource = {
  readable(): boolean;
  /** Events that overlap from..to on the owner's main calendar, in start order. */
  between(from: string, to: string): Promise<CalendarEvent[]>;
};

/** What was told, by event and start: a moved event is told again at its new time. */
type Told = Record<string, string>;

const TOLD_KEY = "calendar_told";
/** The clock beats each minute; a look due within this slack of its time happens at this beat, not the next one. */
const SLACK_MS = 30_000;

const keyOf = (e: CalendarEvent) => `${e.id}@${e.start}`;

/**
 * The events starting after now and within `leadMin` that were not told: all-day, declined and cancelled ones
 * never are. `told` keeps only events still ahead, so it stays small.
 */
export function dueEvents(
  events: readonly CalendarEvent[],
  told: Told,
  now: Date,
  leadMin: number,
): { due: CalendarEvent[]; told: Told } {
  const at = now.getTime();
  const until = at + leadMin * 60_000;
  const kept: Told = Object.fromEntries(Object.entries(told).filter(([, start]) => Date.parse(start) > at));
  const due = events.filter((e) => {
    const start = e.start ? Date.parse(e.start) : Number.NaN;
    return !e.all_day && !e.declined && e.status !== "cancelled" && start > at && start <= until && !(keyOf(e) in kept);
  });
  for (const e of due) kept[keyOf(e)] = e.start ?? "";
  return { due, told: kept };
}

/** One line per event, in the owner's language and time zone: when, how soon, what and where. */
export function eventTexts(store: Store, events: readonly CalendarEvent[], now: Date): string[] {
  const texts = channelTexts(store);
  const tz = ownerTimeZone(store);
  const clock = new Intl.DateTimeFormat(texts.locale, {
    hour: "2-digit",
    minute: "2-digit",
    ...(tz ? { timeZone: tz } : {}),
  });
  return events.map((e) => {
    const start = new Date(e.start ?? "");
    const inMin = Math.max(1, Math.round((start.getTime() - now.getTime()) / 60_000));
    const where = [e.location, e.meet].filter((w): w is string => Boolean(w));
    return texts.event(e.title, clock.format(start), inMin, where);
  });
}

/** The reminders as a background check: off until the owner turns them on in Google Calendar's settings. */
export function calendarReminders(deps: {
  store: Store;
  source: CalendarSource;
  /** Tells the owner, past the daily cap and quiet hours: they asked for it. */
  remind: (texts: string[], events: CalendarEvent[]) => void;
}): BackgroundCheck {
  const { store, source } = deps;
  let lastAt = Number.NEGATIVE_INFINITY;
  return {
    id: "calendar-reminders",
    everyMs: 60_000,
    run: async (at) => {
      const { enabled, lead_min, every_min } = store.settings.read("calendar_reminders");
      if (!enabled || !source.readable()) return;
      // Looking less often than the lead time would let an event start between two looks, untold.
      if (at.getTime() - lastAt < Math.min(every_min, lead_min) * 60_000 - SLACK_MS) return;
      lastAt = at.getTime();
      const events = await source.between(at.toISOString(), new Date(at.getTime() + lead_min * 60_000).toISOString());
      let told: Told = {};
      try {
        told = JSON.parse(store.settings.get(TOLD_KEY) ?? "{}") as Told;
      } catch {}
      const next = dueEvents(events, told, at, lead_min);
      store.settings.set(TOLD_KEY, JSON.stringify(next.told));
      if (next.due.length) deps.remind(eventTexts(store, next.due, at), next.due);
    },
  };
}
