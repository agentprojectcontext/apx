import type { NewsEntry } from "./entries.ts";

// Told once to an owner whose contacts write to them and who has Google Calendar connected: appointments can now be
// booked straight on the calendar instead of only noted (DECISIONS.md#d-239).
export const CONTACT_BOOKING_NEWS: NewsEntry = {
  id: "contact-booking",
  since: "2.16.0",
  title: {
    en: "Contacts can book on your calendar",
    es: "Tus contactos pueden agendar en tu calendario",
  },
  about: {
    en:
      "Appointments a contact asks for can now go straight on your Google Calendar, at a free time inside the " +
      "account's attention hours, instead of only being noted for you to confirm. You are told each time and can " +
      "cancel with one tap.",
    es:
      "Las citas que pide un contacto ahora pueden ir directo a tu Google Calendar, en un horario libre dentro del " +
      "horario de atención de la cuenta, en vez de solo anotarse para que las confirmes. Te aviso cada vez y la " +
      "cancelás con un toque.",
  },
  applies: (facts) => facts.contacts && facts.google.calendar,
  text:
    "Appointments contacts ask for can be booked straight on the owner's Google Calendar: a channel's contacts " +
    "{appointments: book} (or a contact's perms.appointments book) with apx_settings channels.set or contacts.set; " +
    "note keeps noting them as tasks, off takes none. Booking needs the account's attention hours (hours) and " +
    "appointment_minutes sets how long each lasts (15, 30, 45 or 60). APX books only free times inside those hours, " +
    "two hours to two weeks ahead, one coming per person and three a day per account, and tells the owner each time; " +
    "contacts.bookings lists them and contacts.cancel_booking cancels one and tells the contact. Offer it to an owner " +
    "whose contacts ask for appointments; change nothing until they say which account and hours.",
  actions: [
    {
      label: { en: "Let contacts book", es: "Que agenden solos" },
      prompt:
        "Show me which of my accounts take appointments from contacts and their attention hours, and ask me where " +
        "contacts should book straight on my calendar. Change nothing until I say so.",
    },
  ],
};
