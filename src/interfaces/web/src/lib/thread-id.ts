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

/**
 * The PERSON half of a thread id, when it has one.
 *
 * Only for an id whose first half is a date: `andy~claude-code` is an a2a pair,
 * not a day and a person, and reading its suffix as a contact would scope a
 * session list to a thing that is not a contact at all.
 *
 * It is the raw key the ledger recorded, which is enough to ask "does this
 * thread belong to somebody" but NOT enough to ask "to the same somebody": one
 * human writes from several addresses, so comparing two raw keys is the
 * daemon's `contact_person` job (api/thread-faces.js).
 */
export function threadContact(id: string | undefined | null): string | undefined {
  if (!id) return undefined;
  const cut = String(id).indexOf("~");
  if (cut <= 0 || !threadDate(id)) return undefined;
  return String(id).slice(cut + 1) || undefined;
}
