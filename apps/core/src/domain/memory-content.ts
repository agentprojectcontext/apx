export const memoryPlain = (text: string) =>
  text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

/** Conservative overlap also catches a forgotten quote inside a longer source message. */
export function sameMemory(a: string, b: string): boolean {
  const x = memoryPlain(a),
    y = memoryPlain(b);
  if (!x || !y) return false;
  if (x === y || (Math.min(x.length, y.length) >= 18 && (` ${x} `.includes(` ${y} `) || ` ${y} `.includes(` ${x} `))))
    return true;
  if ((x.match(/\d+/g) ?? []).join(",") !== (y.match(/\d+/g) ?? []).join(",")) return false;
  if (/\b(no|not|never|nunca|sin|without)\b/.test(x) !== /\b(no|not|never|nunca|sin|without)\b/.test(y)) return false;

  const words = (s: string) => new Set(s.split(" ").filter((w) => w.length > 3));
  const left = words(x),
    right = words(y);
  const shared = [...left].filter((w) => right.has(w)).length;
  return shared >= 3 && shared / Math.max(left.size, right.size) >= 0.75;
}

/** Automatic deduplication must not collapse corrections with the same bag of words. */
export const memoryKey = (text: string) =>
  text
    .normalize("NFC")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[.!]+$/, "");
export const duplicateMemory = (a: string, b: string) => memoryKey(a) === memoryKey(b);

export const isMemoryGreeting = (text: string) =>
  /^(hola|hello|hi|hey|gracias|thanks|buen[oa]s?(?: d[ií]as| tardes| noches)?)[!.\s]*$/i.test(text.trim());

/** Overlap preserves topic boundaries; the source is capped at 4000 characters before indexing. */
export function memoryFragments(text: string): string[] {
  const parts: string[] = [];
  for (let start = 0; start < text.length; start += 640) {
    parts.push(text.slice(start, start + 800));
    if (start + 800 >= text.length) break;
  }
  return parts;
}

const NEGATION = /\b(no|not|never|nunca|jamas|sin|without|ni|dont|doesnt|isnt|instead|rather|en vez|en lugar)\b/;
const IDENTIFIER = /[\p{L}\p{N}_~-]*(?:\d|[./@:])[\p{L}\p{N}_~./@:-]*[\p{L}\p{N}]/gu;
const LABEL = /^\s*(why|how to apply)\s*:/i;
const stems = (s: string) =>
  new Set(
    memoryPlain(s)
      .split(" ")
      .filter((w) => w.length >= 4)
      .map((w) => w.slice(0, 5)),
  );

/**
 * An automatic note says the owner's fact in the agent's words, but only what the quote supports: every number,
 * name and identifier comes from the quote, negations survive, and the rule shares its distinctive words.
 */
export function factSupported(fact: string, quote: string): boolean {
  const q = memoryPlain(quote);
  const lines = fact.split("\n").filter((l) => l.trim());
  const rule = lines[0] ?? "";
  if (!rule.trim() || LABEL.test(rule)) return false;
  const nums = new Set(q.match(/\d+/g) ?? []);
  if ((memoryPlain(fact).match(/\d+/g) ?? []).some((n) => !nums.has(n))) return false;
  const ids = lines.flatMap((l) => l.replace(LABEL, "").match(IDENTIFIER) ?? []);
  if (ids.some((id) => !q.includes(memoryPlain(id)))) return false;
  // Proper names in the rule (capitalized past its first word) must be the owner's, not the model's.
  const names = rule
    .split(/\s+/)
    .slice(1)
    .filter((w) => /^\p{Lu}/u.test(w));
  if (names.some((n) => memoryPlain(n) && !q.includes(memoryPlain(n)))) return false;
  if (NEGATION.test(memoryPlain(rule)) !== NEGATION.test(q)) return false;
  const want = stems(rule);
  const have = stems(quote);
  const shared = [...want].filter((w) => have.has(w)).length;
  return shared >= Math.min(2, want.size) && shared / Math.max(1, want.size) >= 0.34;
}

const DAY = 86_400_000;
const RELATIVE: Array<[RegExp, (day: (offset: number) => string) => string]> = [
  [/\bpasado mañana\b/gi, (d) => `el ${d(2)}`],
  [/\b(?:esta mañana|esta tarde|esta noche|hoy)\b/gi, (d) => `el ${d(0)}`],
  [/\banoche\b/gi, (d) => `la noche del ${d(-1)}`],
  [/\bayer\b/gi, (d) => `el ${d(-1)}`],
  [/(?<!\b(?:la|esta|una|cada)\s)\bmañana\b/gi, (d) => `el ${d(1)}`],
  ...english(/(?:this morning|this afternoon|this evening|tonight|today)/, 0),
  ...english(/yesterday/, -1),
  ...english(/tomorrow/, 1),
];

/** After a preposition ("moved to tomorrow") the date stands alone; elsewhere it reads "on <date>". */
function english(word: RegExp, offset: number): Array<[RegExp, (day: (offset: number) => string) => string]> {
  return [
    [
      new RegExp(`(?<=\\b(?:to|for|until|by|from|since|before|after|on|of)\\s)${word.source}\\b`, "gi"),
      (d) => d(offset),
    ],
    [new RegExp(`\\b${word.source}\\b`, "gi"), (d) => `on ${d(offset)}`],
  ];
}

/** Relative day words ("today", "ayer") read as the dates they meant on `day` (YYYY-MM-DD, the note's own day). */
export function absoluteDates(text: string, day: string): string {
  const base = Date.parse(`${day}T12:00:00Z`);
  if (Number.isNaN(base)) return text;
  const at = (offset: number) => new Date(base + offset * DAY).toISOString().slice(0, 10);
  let out = text;
  for (const [re, to] of RELATIVE)
    out = out.replace(re, (_m, offset: number, all: string) => {
      const said = to(at);
      return offset === 0 || /[.!?]\s+$/.test(all.slice(0, offset)) ? said[0]?.toUpperCase() + said.slice(1) : said;
    });
  return out;
}

/** Every `quoted` fragment of a procedure note is a tool or an argument of one of the run's own successful steps. */
export function procedureSupported(
  text: string,
  steps: Array<{ tool: string; args: Record<string, unknown>; state: string }>,
): boolean {
  const fragments = [...text.matchAll(/`([^`\n]+)`/g)].map((m) => m[1] as string);
  const said = steps
    .filter((s) => s.state === "ok")
    .flatMap((s) => [s.tool, ...Object.values(s.args).flatMap((v) => (typeof v === "string" ? [v] : []))]);
  return fragments.length > 0 && fragments.every((f) => said.some((v) => v.includes(f)));
}
