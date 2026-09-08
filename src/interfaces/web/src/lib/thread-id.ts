/**
 * A channel thread's id is a day — and, where one day holds several people, a
 * day plus the person.
 *
 *   "2026-09-08"                      the whole day (telegram, web, desktop …)
 *   "2026-09-08~owner"                the owner's WhatsApp conversation
 *   "2026-09-08~5491155555555@lid"    one contact's
 *
 * It stays one opaque string so a thread is still addressed by (channel, id)
 * everywhere — the URL, the sidebar, the activity key. The only thing anyone
 * needs to take apart is the date, because the header prints it: handing the
 * whole id to `new Date()` renders "Invalid Date" the moment a thread belongs
 * to a person.
 */
export function threadDate(id: string | undefined | null): string | undefined {
  if (!id) return undefined;
  const day = String(id).split("~")[0];
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : undefined;
}
