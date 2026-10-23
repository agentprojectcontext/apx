// Google Calendar's REST API, flattened to what a prompt needs: events in a range, free time, creating, changing and
// cancelling an event (invitations go out as the owner).
import { randomUUID } from "node:crypto";
import type { Google } from "./google.ts";

const ID = "google-calendar" as const;

type GEvent = {
  id?: string;
  summary?: string;
  description?: string;
  location?: string;
  status?: string;
  htmlLink?: string;
  hangoutLink?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  attendees?: Array<{ email?: string; responseStatus?: string; optional?: boolean; organizer?: boolean }>;
  organizer?: { email?: string };
};

export type CalendarEvent = {
  id: string;
  title: string;
  start: string | undefined;
  end: string | undefined;
  all_day: boolean;
  location?: string;
  description?: string;
  attendees?: string[];
  organizer?: string;
  status?: string;
  meet?: string;
  link?: string;
};

export function flattenEvent(e: GEvent): CalendarEvent {
  const attendees = (e.attendees ?? []).flatMap((a) =>
    a.email ? [a.responseStatus ? `${a.email} (${a.responseStatus})` : a.email] : [],
  );
  return {
    id: e.id ?? "",
    title: e.summary || "(no title)",
    start: e.start?.dateTime ?? e.start?.date,
    end: e.end?.dateTime ?? e.end?.date,
    all_day: Boolean(e.start?.date),
    ...(e.location ? { location: e.location } : {}),
    ...(e.description ? { description: e.description.slice(0, 1000) } : {}),
    ...(attendees.length ? { attendees } : {}),
    ...(e.organizer?.email ? { organizer: e.organizer.email } : {}),
    ...(e.status && e.status !== "confirmed" ? { status: e.status } : {}),
    ...(e.hangoutLink ? { meet: e.hangoutLink } : {}),
    ...(e.htmlLink ? { link: e.htmlLink } : {}),
  };
}

/** A day ("2026-05-04") is an all-day time; anything else a moment with its offset. */
const when = (t: string, timeZone?: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(t) ? { date: t } : { dateTime: t, ...(timeZone ? { timeZone } : {}) };

const events = (g: Google, calendar: string) =>
  `${g.endpoints.calendar}/calendars/${encodeURIComponent(calendar)}/events`;
const eventUrl = (g: Google, calendar: string, id: string) => `${events(g, calendar)}/${encodeURIComponent(id)}`;
const meetRequest = () => ({
  conferenceData: { createRequest: { requestId: randomUUID(), conferenceSolutionKey: { type: "hangoutsMeet" } } },
});
const sameEmail = (a: string | undefined, b: string) => a?.toLowerCase() === b.toLowerCase();

export function calendarApi(g: Google) {
  return {
    async list(o: { from: string; to: string; q?: string | undefined; max: number; calendar: string }) {
      const data = await g.call<{ items?: GEvent[]; timeZone?: string }>(ID, events(g, o.calendar), {
        query: {
          timeMin: o.from,
          timeMax: o.to,
          q: o.q,
          maxResults: o.max,
          singleEvents: true,
          orderBy: "startTime",
        },
      });
      return { timeZone: data.timeZone, events: (data.items ?? []).map(flattenEvent) };
    },

    /** Busy blocks from Google's free/busy view, and the gaps of at least `minutes` between them. */
    async free(o: { from: string; to: string; minutes: number; limit: number; calendar: string }) {
      const data = await g.call<{ calendars?: Record<string, { busy?: Array<{ start: string; end: string }> }> }>(
        ID,
        `${g.endpoints.calendar}/freeBusy`,
        { method: "POST", body: { timeMin: o.from, timeMax: o.to, items: [{ id: o.calendar }] } },
      );
      const busy = Object.values(data.calendars ?? {})
        .flatMap((c) => c.busy ?? [])
        .map((b) => [Date.parse(b.start), Date.parse(b.end)] as const)
        .filter(([s, e]) => Number.isFinite(s) && Number.isFinite(e))
        .sort((a, b) => a[0] - b[0]);
      return { busy: busy.map(([s, e]) => ({ start: iso(s), end: iso(e) })), free: gaps(o, busy) };
    },

    async create(o: {
      title: string;
      start: string;
      end: string;
      description?: string | undefined;
      location?: string | undefined;
      attendees?: string[] | undefined;
      meet?: boolean | undefined;
      time_zone?: string | undefined;
      calendar: string;
    }) {
      const invites = Boolean(o.attendees?.length);
      const data = await g.call<GEvent>(ID, events(g, o.calendar), {
        method: "POST",
        query: { ...(o.meet ? { conferenceDataVersion: 1 } : {}), ...(invites ? { sendUpdates: "all" } : {}) },
        body: {
          summary: o.title,
          ...(o.description ? { description: o.description } : {}),
          ...(o.location ? { location: o.location } : {}),
          start: when(o.start, o.time_zone),
          end: when(o.end, o.time_zone),
          ...(invites ? { attendees: o.attendees?.map((email) => ({ email })) } : {}),
          ...(o.meet ? meetRequest() : {}),
        },
      });
      return flattenEvent(data);
    },

    async get(o: { id: string; calendar: string }) {
      return flattenEvent(await g.call<GEvent>(ID, eventUrl(g, o.calendar, o.id)));
    },

    /**
     * Changes what is given. `attendees` is the whole new list; `add_attendees`/`remove_attendees` change the current
     * one (who already answered keeps their answer); `meet` adds a Meet link if it has none.
     */
    async update(o: {
      id: string;
      title?: string | undefined;
      start?: string | undefined;
      end?: string | undefined;
      description?: string | undefined;
      location?: string | undefined;
      attendees?: string[] | undefined;
      add_attendees?: string[] | undefined;
      remove_attendees?: string[] | undefined;
      meet?: boolean | undefined;
      time_zone?: string | undefined;
      calendar: string;
    }) {
      const changesGuests = Boolean(o.add_attendees?.length || o.remove_attendees?.length);
      const current = changesGuests || o.meet ? await g.call<GEvent>(ID, eventUrl(g, o.calendar, o.id)) : undefined;
      let guests: GEvent["attendees"] = o.attendees?.map((email) => ({ email }));
      if (current && changesGuests) {
        const kept = (guests ?? current.attendees ?? []).filter(
          (a) => !o.remove_attendees?.some((r) => sameEmail(a.email, r)),
        );
        const added = (o.add_attendees ?? [])
          .filter((e, i, all) => !kept.some((a) => sameEmail(a.email, e)) && all.indexOf(e) === i)
          .map((email) => ({ email }));
        guests = [...kept, ...added];
      }
      const addMeet = Boolean(o.meet && current && !current.hangoutLink);
      const data = await g.call<GEvent>(ID, eventUrl(g, o.calendar, o.id), {
        method: "PATCH",
        // Attendees already invited hear about a change of time or place.
        query: { sendUpdates: "all", ...(addMeet ? { conferenceDataVersion: 1 } : {}) },
        body: {
          ...(o.title !== undefined ? { summary: o.title } : {}),
          ...(o.description !== undefined ? { description: o.description } : {}),
          ...(o.location !== undefined ? { location: o.location } : {}),
          ...(o.start !== undefined ? { start: when(o.start, o.time_zone) } : {}),
          ...(o.end !== undefined ? { end: when(o.end, o.time_zone) } : {}),
          ...(guests !== undefined ? { attendees: guests } : {}),
          ...(addMeet ? meetRequest() : {}),
        },
      });
      return flattenEvent(data);
    },

    /** Cancels an event; its attendees are told. */
    async cancel(o: { id: string; calendar: string }) {
      await g.call(ID, eventUrl(g, o.calendar, o.id), { method: "DELETE", query: { sendUpdates: "all" } });
    },
  };
}

const iso = (ms: number) => new Date(ms).toISOString();

/** The first gaps of at least `minutes` between from and to, around the busy blocks (sorted by start). */
export function gaps(
  o: { from: string; to: string; minutes: number; limit: number },
  busy: ReadonlyArray<readonly [number, number]>,
): Array<{ start: string; end: string }> {
  const need = o.minutes * 60_000;
  const end = Date.parse(o.to);
  const out: Array<{ start: string; end: string }> = [];
  let cursor = Date.parse(o.from);
  for (const [s, e] of busy) {
    if (cursor >= end) break;
    const until = Math.min(s, end);
    if (until - cursor >= need) out.push({ start: iso(cursor), end: iso(until) });
    cursor = Math.max(cursor, e);
    if (out.length >= o.limit) return out;
  }
  if (end - cursor >= need) out.push({ start: iso(cursor), end: iso(end) });
  return out.slice(0, o.limit);
}
