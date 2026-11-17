// Appointments contacts booked on the owner's calendar from their chat, kept in the "contact_bookings" setting so the
// caps (one coming per person, a few per day per account) and the owner's Cancel can find them. See DECISIONS.md#d-239
import { randomUUID } from "node:crypto";
import type { ContactBooking } from "@apx/protocol";
import type { Store } from "./store.ts";

/** Past bookings are kept this long, then dropped. */
const KEEP_PAST_MS = 30 * 24 * 3600_000;

export function contactBookings(store: Store) {
  const all = () => store.settings.read("contact_bookings");
  const save = (list: ContactBooking[], at: Date) =>
    store.settings.write(
      "contact_bookings",
      list.filter((b) => Date.parse(b.end) > at.getTime() - KEEP_PAST_MS),
    );
  const coming = (at: Date) => all().filter((b) => b.state === "booked" && Date.parse(b.end) > at.getTime());
  return {
    get: (id: string) => all().find((b) => b.id === id),
    /** The ones still to happen, soonest first; with past, the ended and canceled ones too, newest first after. */
    list(at: Date, o: { person?: string | undefined; past?: boolean | undefined } = {}): ContactBooking[] {
      const mine = (b: ContactBooking) => !o.person || b.person_id === o.person;
      const ahead = coming(at)
        .filter(mine)
        .sort((a, b) => a.start.localeCompare(b.start));
      if (!o.past) return ahead;
      const rest = all()
        .filter((b) => mine(b) && !ahead.includes(b))
        .sort((a, b) => b.start.localeCompare(a.start));
      return [...ahead, ...rest];
    },
    /** This person's booking still to happen, if any. */
    comingFor: (person: string, at: Date) => coming(at).find((b) => b.person_id === person),
    /** Bookings on an account whose start falls between two moments (a day of the owner's). */
    onAccountBetween: (channel: string, from: number, to: number) =>
      coming(new Date(from)).filter(
        (b) => b.channel === channel && Date.parse(b.start) >= from && Date.parse(b.start) < to,
      ).length,
    add(b: Omit<ContactBooking, "id" | "state" | "created_at">, at: Date): ContactBooking {
      const booking: ContactBooking = {
        ...b,
        id: `bkg_${randomUUID().replaceAll("-", "").slice(0, 16)}`,
        state: "booked",
        created_at: at.toISOString(),
      };
      save([...all(), booking], at);
      return booking;
    },
    cancel(id: string, by: "contact" | "owner", at: Date): ContactBooking | undefined {
      const list = all();
      const cur = list.find((b) => b.id === id);
      if (!cur || cur.state !== "booked") return undefined;
      const next: ContactBooking = { ...cur, state: "canceled", canceled_by: by };
      save(
        list.map((b) => (b.id === id ? next : b)),
        at,
      );
      return next;
    },
  };
}

/** A tray notice about a booking names it, so the notice can cancel it. */
export const bookingRef = (id: string) => `booking:${id}`;

/** Whether a contact's tool call booked or canceled an appointment (what the owner is told when the turn ends). */
export function bookingDone(s: { tool: string; state: string; result?: string | undefined }) {
  if (s.state !== "ok") return undefined;
  if (s.tool === "book_appointment" && s.result?.startsWith("booked:")) return "booked" as const;
  if (s.tool === "cancel_my_appointment" && s.result?.startsWith("canceled:")) return "canceled" as const;
  return undefined;
}
