// A contact books an appointment on the owner's Google Calendar from their chat, when the owner set appointments to
// "book" for them or their account. The only write a contact's words make to something of the owner's without a
// confirmation, so every limit is checked here, never left to the model: the account's hours, two hours ahead at
// least, two weeks at most, clear of every busy block (free/busy only, never an event's details), one coming per
// person and three a day per account. The event's title is APX's, it invites nobody. See DECISIONS.md#d-239
import type { ChannelHours, Person } from "@apx/protocol";
import { z } from "zod";
import { channelTexts } from "../channels/texts.ts";
import { BOOKING_HORIZON_DAYS, bookableStarts, bookingWindow, localSlot, offerOf } from "../domain/booking-slots.ts";
import { contactBookings } from "../domain/contact-bookings.ts";
import { contactRights } from "../domain/contact-rights.ts";
import { dayStart } from "../domain/hours.ts";
import { ownerTimeZone } from "../domain/owner.ts";
import type { Store } from "../domain/store.ts";
import { calendarApi } from "../integrations/calendar.ts";
import type { Google } from "../integrations/google.ts";
import { defineTool, type Tool } from "./types.ts";

/** Appointments an account takes from its contacts on one of the owner's days. */
const BOOKINGS_PER_DAY = 3;
/** How long a booked appointment lasts when the account does not say. */
const DEFAULT_APPOINTMENT_MINUTES = 30;

/** Their names are what domain/contact-bookings.ts `bookingDone` reads in a turn's steps. */
export const BOOK_TOOL = "book_appointment";
export const CANCEL_BOOKING_TOOL = "cancel_my_appointment";

type Chat = {
  id: string;
  project_id?: string | undefined;
  channel?: { id: string; person_id?: string | undefined } | undefined;
};

/** Who this chat is with and the account they write on, when they may book there now; else why not. */
function bookerIn(store: Store, google: Google, thread: Chat) {
  const personId = thread.channel?.person_id;
  const person: Person | undefined = personId ? store.persons.get(personId) : undefined;
  const cfg = thread.channel ? store.settings.read("channels").find((c) => c.id === thread.channel?.id) : undefined;
  if (!person || !cfg || person.role !== "contact") return undefined;
  if (contactRights(store, person, cfg.id).appointments !== "book") return undefined;
  // Supervised, silenced or unreviewed contacts get drafts or nothing, never a turn with tools; checked all the same.
  if (person.supervised || person.unreviewed || person.muted) return undefined;
  if (!cfg.hours || !google.usable("google-calendar", thread.project_id)) return undefined;
  return { person, account: cfg, hours: cfg.hours, minutes: cfg.appointment_minutes ?? DEFAULT_APPOINTMENT_MINUTES };
}

/** Bookings are made one at a time in this core, so two chats never take the same free time. */
let queue: Promise<unknown> = Promise.resolve();
const oneAtATime = <T>(f: () => Promise<T>): Promise<T> => {
  const next = queue.then(f, f);
  queue = next.catch(() => undefined);
  return next;
};

export function bookingTools(store: Store, google: Google | undefined, now: () => Date = () => new Date()): Tool[] {
  if (!google) return [];
  const g = google;
  const cal = calendarApi(g);
  const bookings = contactBookings(store);

  /** What the owner's calendar and the account's caps leave free, from the bookable range on. */
  async function free(hours: ChannelHours, minutes: number, channel: string, day?: string) {
    const at = now();
    const tz = ownerTimeZone(store);
    const { from, to } = bookingWindow(at);
    const r = await cal.free({
      from: new Date(from).toISOString(),
      to: new Date(to).toISOString(),
      minutes,
      limit: 1,
      calendar: "primary",
    });
    const busy = r.busy.map((b) => [Date.parse(b.start), Date.parse(b.end)] as const);
    const full = new Map<string, boolean>();
    const dayFull = (day: string, on: Date) => {
      if (!full.has(day)) {
        const start = dayStart(on, tz).getTime();
        full.set(day, bookings.onAccountBetween(channel, start, start + 24 * 3600_000) >= BOOKINGS_PER_DAY);
      }
      return full.get(day) === true;
    };
    return { tz, starts: bookableStarts({ hours, minutes, timeZone: tz, now: at, busy, dayFull }, day) };
  }

  const listed = (starts: Date[], tz: string | undefined) =>
    starts.map((s) => `${localSlot(s, tz)} (${channelTexts(store).bookingWhen(s, tz)})`).join("\n");

  return [
    defineTool({
      name: BOOK_TOOL,
      description:
        "Book an appointment the person asks for on your owner's calendar. First call without start (day narrows it) to get the times that are free; offer them, never others. Then call with the start they chose and the reason they gave. Only a booked result is confirmed: tell them the day and time it returns. If it refuses, offer the times it lists, or pass the request on with pass_request kind appointment.",
      args: z.object({
        start: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)
          .optional()
          .describe("one of the free times, exactly as listed (YYYY-MM-DDTHH:MM)"),
        day: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional()
          .describe("only free times on this day"),
        reason: z.string().trim().min(3).max(300).optional().describe("what the appointment is for, in their words"),
      }),
      // Bounded here (hours, free/busy, caps), and the owner turned booking on for this person or account.
      effect: "external",
      confirm: "never",
      deadlineMs: 30_000,
      when: (t) => Boolean(bookerIn(store, g, t)),
      title: (a) => (a.start ? `Booked an appointment: ${String(a.start).replace("T", " ")}` : "Looked for free times"),
      async run(a, ctx) {
        const who = bookerIn(store, g, ctx.thread);
        if (!who) throw new Error("appointments are not booked in this chat: pass the request on instead");
        const { person, account, hours, minutes } = who;
        const at = now();
        const coming = bookings.comingFor(person.id, at);
        if (coming)
          return `not booked: ${person.name} already has an appointment on ${channelTexts(store).bookingWhen(new Date(coming.start), ownerTimeZone(store))}. Another one is passed on with pass_request kind appointment.`;
        if (!a.start) {
          const { tz, starts } = await free(hours, minutes, account.id, a.day);
          const offer = offerOf(starts, tz);
          if (!offer.length)
            return a.day
              ? "no free times that day. Ask for another day, or pass the request on."
              : `no free times in the next ${BOOKING_HORIZON_DAYS} days. Pass the request on with pass_request kind appointment.`;
          return `Free times (${minutes} minutes each), the only ones you may offer:\n${listed(offer, tz)}`;
        }
        const start = a.start;
        return oneAtATime(async () => {
          // Checked again right before booking: the calendar or another chat may have taken it meanwhile.
          const { tz, starts } = await free(hours, minutes, account.id, start.slice(0, 10));
          const chosen = starts.find((s) => localSlot(s, tz) === start);
          if (!chosen) {
            const others = offerOf(starts, tz);
            return others.length
              ? `not booked: ${start.replace("T", " ")} is not free. Free that day:\n${listed(others, tz)}`
              : `not booked: ${start.replace("T", " ")} is not free and nothing else is that day. Ask for another day.`;
          }
          const end = new Date(chosen.getTime() + minutes * 60_000);
          const texts = channelTexts(store);
          const event = await cal.create({
            title: texts.bookingTitle(person.name),
            start: chosen.toISOString(),
            end: end.toISOString(),
            description: texts.bookingDescription(account.label, a.reason),
            calendar: "primary",
          });
          bookings.add(
            {
              person_id: person.id,
              channel: account.id,
              thread_id: ctx.thread.id,
              event_id: event.id,
              start: chosen.toISOString(),
              end: end.toISOString(),
            },
            at,
          );
          return `booked: ${texts.bookingWhen(chosen, tz)}, ${minutes} minutes. Your owner was told.`;
        });
      },
    }),
    defineTool({
      name: CANCEL_BOOKING_TOOL,
      description: "Cancel the appointment this person booked, when they ask to. Only theirs; it tells your owner.",
      args: z.object({}),
      effect: "external",
      confirm: "never",
      deadlineMs: 30_000,
      when: (t) => {
        const id = t.channel?.person_id;
        return Boolean(id && bookings.comingFor(id, now()));
      },
      title: () => "Canceled their appointment",
      async run(_a, ctx) {
        const personId = ctx.thread.channel?.person_id;
        const at = now();
        const coming = personId ? bookings.comingFor(personId, at) : undefined;
        if (!coming) return "they have no appointment to cancel.";
        await cal.cancel({ id: coming.event_id, calendar: "primary" });
        bookings.cancel(coming.id, "contact", at);
        return `canceled: ${channelTexts(store).bookingWhen(new Date(coming.start), ownerTimeZone(store))}. Your owner was told.`;
      },
    }),
  ];
}
