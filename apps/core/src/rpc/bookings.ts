// Appointments contacts booked on the owner's calendar (DECISIONS.md#d-238): listed, and canceled by the owner from the
// tray's notice or through the super-agent, which also tells the contact.
import type { Channels } from "../channels/manager.ts";
import { channelTexts } from "../channels/texts.ts";
import { bookingRef, contactBookings } from "../domain/contact-bookings.ts";
import { ownerTimeZone } from "../domain/owner.ts";
import type { Store } from "../domain/store.ts";
import { errorMessage, notFound } from "../errors.ts";
import { calendarApi } from "../integrations/calendar.ts";
import type { Google } from "../integrations/google.ts";
import type { Handlers } from "./router.ts";

export function bookingHandlers(
  store: Store,
  google: Google,
  channels: Pick<Channels, "sendAsOwner">,
  now: () => Date = () => new Date(),
): Pick<Handlers, "contacts.bookings" | "contacts.cancel_booking"> {
  const bookings = contactBookings(store);
  return {
    "contacts.bookings": ({ person, past }) => ({ bookings: bookings.list(now(), { person, past }) }),
    "contacts.cancel_booking": async ({ id, tell }) => {
      const cur = bookings.get(id);
      if (!cur) throw notFound(`appointment ${id}`);
      // Canceled already (from another notice, or by the contact): nothing more to do.
      if (cur.state !== "booked") return { booking: cur, told: false };
      try {
        await calendarApi(google).cancel({ id: cur.event_id, calendar: "primary" });
      } catch (err) {
        // Already gone from the calendar (the owner deleted it there): it is canceled all the same.
        if (!/404|410|not found|deleted/i.test(errorMessage(err))) throw err;
      }
      const booking = bookings.cancel(id, "owner", now()) ?? cur;
      store.notifications.resolve("channel", bookingRef(id));
      let told = false;
      if (tell) {
        const texts = channelTexts(store);
        const when = texts.bookingWhen(new Date(cur.start), ownerTimeZone(store));
        try {
          channels.sendAsOwner(cur.thread_id, texts.bookingCanceled(when));
          told = true;
        } catch {
          // Their chat is gone or the account removed: `told` says so, and the owner tells them another way.
        }
      }
      return { booking, told };
    },
  };
}
