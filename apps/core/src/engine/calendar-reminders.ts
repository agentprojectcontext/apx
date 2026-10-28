// Event reminders: which of the owner's Google Calendar events start within the lead time and were not told yet.

/** An event as a calendar routine sees it. */
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

/** How long before an event starts the owner hears of it, when the running profile does not say. */
export const DEFAULT_LEAD_MIN = 30;

/** The owner's Google Calendar for a calendar routine; `readable` is false while it is not connected here. */
export type CalendarSource = {
  readable(project: string | undefined): boolean;
  /** Events that overlap from..to on the owner's main calendar, in start order. */
  between(from: string, to: string): Promise<CalendarEvent[]>;
};

/** What was told, by event and start: a moved event is told again at its new time. */
type Told = Record<string, string>;

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

/** One line per event for the routine's agent: what, when, how soon and where. */
export function eventLines(events: readonly CalendarEvent[], now: Date): string {
  return events
    .map((e) =>
      JSON.stringify({
        title: e.title,
        start: e.start,
        in_minutes: Math.round((Date.parse(e.start ?? "") - now.getTime()) / 60_000),
        ...(e.location ? { location: e.location } : {}),
        ...(e.meet ? { meet: e.meet } : {}),
      }),
    )
    .join("\n");
}
