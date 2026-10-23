// What an agent may offer the owner to connect for what they asked: integrations and channels found by words.
import type { ConnectOffer } from "@apx/protocol";

export type Connectable = ConnectOffer & { connected: boolean };

/** Results at most: the card shows the first few. */
const MAX_FOUND = 6;
/** Words that say nothing about which app is meant. */
const FILLER = new Set("the and for with your my me it its from by at this that you to of in on or an".split(" "));

const words = (s: string): string[] =>
  (s.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? []).filter((w) => !FILLER.has(w));

/** "designs" answers "design", and "mail" answers "email" in a name; short words only whole. */
const near = (a: string, b: string) =>
  a === b || (a.length >= 4 && b.length >= 4 && (a.startsWith(b) || b.startsWith(a)));

/**
 * Best first, a connected one before one that is not. A word naming one (its id or label) weighs three times a word
 * of its description, and when some name matches, only those come back: "figma" is Figma, not every app whose
 * description says "designs".
 */
export function findConnectable(all: Connectable[], query: string): Connectable[] {
  const q = [...new Set(words(query))];
  if (!q.length) return [];
  const scored = all.map((c) => {
    const name = words(`${c.id.replaceAll("-", " ")} ${c.label}`);
    const text = words(c.description);
    let named = false;
    let score = 0;
    for (const w of q) {
      if (name.some((x) => near(x, w) || (w.length >= 4 && x.endsWith(w)))) {
        named = true;
        score += 3;
      } else if (text.some((x) => near(x, w))) score += 1;
    }
    return { c, score, named };
  });
  const hits = scored.filter((s) => s.score > 0);
  const anyNamed = hits.some((s) => s.named);
  return hits
    .filter((s) => !anyNamed || s.named)
    .sort((a, b) => b.score - a.score || Number(b.c.connected) - Number(a.c.connected))
    .slice(0, MAX_FOUND)
    .map((s) => s.c);
}
