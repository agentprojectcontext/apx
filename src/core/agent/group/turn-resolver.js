// Group chat turn-taking (option C + cross-mentions).
//
// A group conversation is the owner plus N agents in one room. Who speaks on a
// given human message is decided by @mentions, and mentions CASCADE: if the
// owner writes "@naty …", Naty speaks; if Naty's reply names "@candela",
// Candela speaks next — even though the owner never addressed her. With no
// mention at all, the FIRST agent in the room takes the turn.
//
// This module is pure orchestration: it parses mentions and walks the cascade,
// delegating the actual model call to a `runAgent(slug, ctx)` callback the
// caller injects. That keeps the turn logic unit-testable without engines.

// Agents keep talking as long as they @-mention someone. The only loop guard
// is a ceiling: one human message can produce at most this many agent replies
// (A↔B ping-pong included). After that the cascade stops even if they still cite.
const MAX_TURNS_PER_MESSAGE = 10;

// Strip diacritics + lowercase so "@Natalia", "@natalia" and "@natália" all
// resolve to the same participant.
function norm(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

/**
 * Build the set of tokens that address a participant: its slug and every word
 * of its display name (so "@naty" matches slug `naty` and "@Natalia" matches
 * the agent whose Name is "Natalia"). Multi-word names also match on the full
 * name joined without spaces ("@analytics-bot", "@AnaLucia").
 */
function aliasesFor(participant) {
  const out = new Set();
  const add = (v) => { const n = norm(v); if (n) out.add(n); };
  add(participant.slug);
  if (participant.name) {
    add(participant.name);
    add(participant.name.replace(/\s+/g, ""));
    for (const w of String(participant.name).split(/\s+/)) add(w);
  }
  return out;
}

/**
 * Parse @mentions out of a message body and resolve them to participant slugs.
 * Only AGENT participants can be addressed (mentioning the owner is a no-op —
 * the owner speaks by typing, not by being summoned). The author never mentions
 * themselves into another turn.
 *
 * @param {string} text
 * @param {Array<{slug,name,kind}>} participants
 * @param {string} [authorSlug]  slug of who wrote `text`, excluded from the result
 * @returns {string[]} ordered, de-duplicated slugs of mentioned agents
 */
export function parseMentions(text, participants, authorSlug) {
  const agents = participants.filter((p) => p.kind !== "owner");
  // Longest alias first so "@ana-lucia" wins over a bare "@ana".
  const table = agents
    .map((p) => ({ slug: p.slug, aliases: [...aliasesFor(p)] }))
    .flatMap((p) => p.aliases.map((a) => ({ slug: p.slug, alias: a })))
    .sort((a, b) => b.alias.length - a.alias.length);

  const found = [];
  const seen = new Set();
  // @token where token is a run of letters/digits/_/-  (mentions never span
  // spaces). We scan raw matches and resolve each against the alias table.
  const re = /@([\p{L}\p{N}_-]+)/gu;
  let m;
  while ((m = re.exec(text)) !== null) {
    const token = norm(m[1]);
    const hit = table.find((t) => t.alias === token);
    if (!hit) continue;
    if (hit.slug === authorSlug) continue;
    if (seen.has(hit.slug)) continue;
    seen.add(hit.slug);
    found.push(hit.slug);
  }
  return found;
}

/**
 * Decide who speaks first for a human message: the agents it mentions, in
 * order; or, if it mentions nobody, the first agent in the room.
 *
 * @returns {string[]} slugs to seed the cascade with
 */
export function seedSpeakers(text, participants) {
  const mentioned = parseMentions(text, participants, "owner");
  if (mentioned.length) return mentioned;
  const firstAgent = participants.find((p) => p.kind !== "owner");
  return firstAgent ? [firstAgent.slug] : [];
}

/**
 * Walk a full group turn. Starting from the human message, run each seeded
 * speaker; scan every reply for @mentions and queue those agents — even if
 * they already spoke this turn, so a back-and-forth keeps going until nobody
 * cites anyone (or the ceiling is hit).
 *
 * @param {object} args
 * @param {string} args.text          the human message body
 * @param {Array}  args.participants  [{slug,name,kind}], agents in room order
 * @param {(slug:string, ctx:{reason:string, byOwner:boolean}) => Promise<string>} args.runAgent
 *        Runs one agent's turn against the current transcript and returns its
 *        reply text. The resolver appends it before scanning for mentions.
 * @param {(slug:string) => void} [args.onSpeakerStart]  fires before each run
 * @param {number} [args.maxTurns]
 * @param {{from:string, reason?:string, byOwner?:boolean}} [args.resume]
 *        Regenerating one bubble: start from `from` instead of re-seeding the
 *        whole room from the owner line. Earlier replies this turn stay put;
 *        a new @mention can still pull those speakers in again.
 * @returns {Promise<Array<{slug,text}>>} the replies in the order they were said
 */
export async function resolveGroupTurn({
  text,
  participants,
  runAgent,
  onSpeakerStart,
  maxTurns = MAX_TURNS_PER_MESSAGE,
  resume = null,
}) {
  const replies = [];
  // Each queue entry remembers WHY the agent is speaking: addressed by the
  // owner, or pulled in by another agent's mention. The reason is handed to
  // runAgent so the prompt can frame it ("owner asked you" vs "naty tagged you").
  // A regenerate of one bubble resumes from that speaker; a fresh turn seeds
  // from the owner's @mentions (or the first agent in the room).
  const queue = resume?.from
    ? [{ slug: resume.from, reason: resume.reason || "owner", byOwner: resume.byOwner !== false }]
    : seedSpeakers(text, participants).map((slug) => ({ slug, reason: "owner", byOwner: true }));

  while (queue.length && replies.length < maxTurns) {
    const { slug, reason, byOwner } = queue.shift();
    const participant = participants.find((p) => p.slug === slug && p.kind !== "owner");
    if (!participant) continue;

    onSpeakerStart?.(slug);
    const reply = await runAgent(slug, { reason, byOwner });
    const replyText = typeof reply === "string" ? reply : "";
    replies.push({ slug, text: replyText });

    // A reply can pull anyone in, including someone who already spoke — that's
    // how the ping-pong continues. Skip only if they're already waiting.
    for (const mentioned of parseMentions(replyText, participants, slug)) {
      if (queue.some((q) => q.slug === mentioned)) continue;
      queue.push({ slug: mentioned, reason: slug, byOwner: false });
    }
  }
  return replies;
}

export const __test__ = { norm, aliasesFor, MAX_TURNS_PER_MESSAGE };
