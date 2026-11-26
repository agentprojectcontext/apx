// Interests are public search terms: a few words each, never a sentence (DECISIONS.md#d-278).

/** Words that lead into what the owner cares about without being part of it ("in particular news about X"). */
const LEAD =
  /^(?:(?:me (?:interesa|interesan|gusta|gustan|copa|copan)(?: mucho| bastante)?|(?:i'?m|i am) (?:really )?(?:into|interested in)|i (?:really )?like|todo lo que tenga que ver con|todo (?:lo )?(?:de|sobre)|everything about|en particular|particularmente|especialmente|sobre todo|in particular|especially|mostly|mainly|lo [uú]ltimo (?:de|en|sobre)|las? (?:novedades|noticias) (?:de|sobre)|novedades (?:de|sobre)|noticias (?:de|sobre)|news (?:about|on|from)|updates (?:about|on|from)|the latest (?:on|in|from))\s+)+/i;
/** "A y B", "A and B": two interests when the whole is longer than a short name ("Ciencia y tecnología" stays). */
const AND = /\s+(?:y|e|and|&)\s+/i;
const MAX_WORDS = 5;

const words = (s: string) => s.split(/\s+/).filter(Boolean);

/** Short search terms from what was said: split at commas, a long "A y B" in two, lead-in words and long tails cut. */
export function shortInterests(given: readonly string[]): string[] {
  const out: string[] = [];
  for (const raw of given)
    for (const part of raw.split(/[,;/|()\n]+/)) {
      const lead = part.trim().replace(LEAD, "").trim();
      const pieces = words(lead).length > 3 ? lead.split(AND) : [lead];
      for (const piece of pieces) {
        const term = words(piece.replace(LEAD, "").replace(/[.:!?¡¿"“”]+/g, " "))
          .slice(0, MAX_WORDS)
          .join(" ")
          .trim();
        if (term && !out.some((t) => t.toLowerCase() === term.toLowerCase())) out.push(term);
      }
    }
  return out;
}
