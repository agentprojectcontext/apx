// The model a provider starts the router chain with when the owner adds it: its everyday chat model, read from the
// provider's own list (no model is named in code). Light tiers first, the newest version among them.

/** Names of a provider's everyday tier: quick and cheap, still good with tools. Whole words ("gemini" is no "mini"). */
const LIGHT = /(?:^|[^a-z])(flash|mini|haiku|small|instant|fast)(?:$|[^a-z])/i;
/** Too small for an agent's turns. */
const TINY = /(?:^|[^a-z])(lite|nano|tiny|micro|[1-3]b)(?:$|[^a-z])/i;
/** Not a stable general chat model: previews, snapshots, coders, reasoners-only, guards. */
const ODD =
  /(preview|exp|experimental|beta|alpha|thinking|codex|coder|code|guard|vision|search|instruct|tuning|learnlm)/i;
/** A dated snapshot ("-20251001", "-2024-07-18"): the alias next to it is the one to keep. */
const DATED = /\d{4}-?\d{2}-?\d{2}/;

/** Version numbers in an id, dates left out: "gemini-2.5-flash" → [2, 5]. */
function version(id: string): number[] {
  return (id.replace(DATED, "").match(/\d+/g) ?? []).map(Number);
}

function newer(a: string, b: string): number {
  const va = version(a);
  const vb = version(b);
  for (let i = 0; i < Math.max(va.length, vb.length); i++) {
    const d = (vb[i] ?? -1) - (va[i] ?? -1);
    if (d) return d;
  }
  // Same version: the plain alias before a suffixed or dated twin.
  return a.length - b.length;
}

/** The chat model a new chain gets for this provider, or none when it lists no chat model. */
export function starterModel(models: ReadonlyArray<{ id: string; chat: boolean }>): string | undefined {
  const chat = models.filter((m) => m.chat).map((m) => m.id);
  const usual = chat.filter((id) => !ODD.test(id));
  const plain = usual.filter((id) => !DATED.test(id));
  const pool = plain.length ? plain : usual.length ? usual : chat;
  const light = pool.filter((id) => LIGHT.test(id) && !TINY.test(id));
  const pick = (light.length ? light : pool.filter((id) => !TINY.test(id))).sort(newer)[0];
  return pick ?? pool.sort(newer)[0];
}
