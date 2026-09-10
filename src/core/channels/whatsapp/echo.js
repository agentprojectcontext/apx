// The echo: messages WhatsApp reports as sent by us.
//
// WhatsApp Web is a companion device, not a separate account. Everything the
// owner types on their own phone is mirrored to every paired device, so it
// arrives here through `messages.upsert` carrying `key.fromMe: true`. So do our
// own sends, bounced back a moment after we make them.
//
// The socket used to drop both with one `continue`, and that had a cost nobody
// asked for: the panel's WhatsApp thread showed what the contact said and what
// the auto-reply answered, and NOTHING the owner wrote themselves. Half of
// every conversation the owner actually had was missing from their own record.
//
// Telling the two apart is the whole job of this file, and it is done by id.
// Anything we send is registered here first (see outbox.sendWhatsApp), so an
// echo whose id we recognise is a duplicate of a row we already wrote, and an
// echo whose id we do not is the owner typing on their phone.
//
// Why an id set and not "did we write a row with this body recently": because
// the same person legitimately sends the same words twice, and a comparison
// that cannot tell a repeat from a duplicate silently eats real messages.

// How many of our own message ids to remember.
//
// The echo comes back within seconds, so this only has to outlive the round
// trip — the cap exists to bound memory on a long-running daemon, not to hold
// history. A few hundred covers any plausible burst; beyond that the oldest are
// dropped, and the worst case for a dropped id is one duplicated row, never a
// lost message.
const MAX_REMEMBERED = 500;

/** Insertion-ordered, which is what makes the eviction below oldest-first. */
const ownSends = new Set();

/** Claim a message id as ours, before the echo can arrive. */
export function rememberOwnSend(id) {
  const key = String(id || "").trim();
  if (!key) return;
  // Re-adding would keep an id at its original position in a Set, so drop it
  // first: a re-sent id should be treated as fresh, not as nearly-evicted.
  ownSends.delete(key);
  ownSends.add(key);
  while (ownSends.size > MAX_REMEMBERED) {
    const oldest = ownSends.values().next().value;
    ownSends.delete(oldest);
  }
}

/**
 * Did WE send this, or did the owner type it on their phone?
 *
 * Consuming the id on the way out is deliberate: WhatsApp can deliver the same
 * echo more than once (a reconnect replays it), and an id that stayed in the
 * set forever would suppress a genuine later message that reused it.
 */
export function claimOwnSend(id) {
  const key = String(id || "").trim();
  if (!key || !ownSends.has(key)) return false;
  ownSends.delete(key);
  return true;
}

/** Test seam. */
export function _resetOwnSends() {
  ownSends.clear();
}
