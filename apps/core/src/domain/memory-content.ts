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

// Read on memoryPlain text, where "don't" is "don t".
const NEGATION =
  /\b(no|not|never|nunca|jamas|tampoco|nada|ningun\w*|sin|without|ni|\w+n t|dont|doesnt|isnt|stop|avoid|evit\w*|deja de|instead|rather|en vez|en lugar)\b/;
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
  const have = stems(quote);
  // The rule and each Why / How to apply line say mostly the quote's own words: no invented reasons or rules.
  return lines.every((line, i) => {
    const want = stems(line.replace(LABEL, ""));
    const shared = [...want].filter((w) => have.has(w)).length;
    return i === 0 ? shared >= Math.min(2, want.size) && shared * 2 >= want.size : shared * 2 >= want.size;
  });
}

const DAY = 86_400_000;
const RELATIVE: Array<[RegExp, (day: (offset: number) => string) => string]> = [
  [/\bpasado mañana\b/gi, (d) => `el ${d(2)}`],
  [/\b(?:esta mañana|esta tarde|esta noche|hoy)\b/gi, (d) => `el ${d(0)}`],
  [/\banoche\b/gi, (d) => `la noche del ${d(-1)}`],
  [/\bayer\b/gi, (d) => `el ${d(-1)}`],
  [/(?<!\b(?:la|esta|una|cada|de)\s)\bmañana\b/gi, (d) => `el ${d(1)}`],
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
  // Quoted spans (commands, addresses, the owner's words) are data, never rewritten.
  const parts = text.split(/(`[^`\n]*`|"[^"\n]*")/);
  return parts.map((part, i) => (i % 2 ? part : prose(part, at))).join("");
}

function prose(text: string, at: (offset: number) => string): string {
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

const POLICY =
  /\b(siempre|nunca|jamas|always|never|from now on|going forward|by default|por defecto|every time|whenever|cada vez que|a partir de ahora|de ahora en (mas|adelante))\b/;
const DURABLE =
  /\b(prefiero|prefer|prefers|preferred|me gustan?|no me gustan?|i (like|love|hate|dislike)|odio|soy|me llamo|vivo en|trabajo (en|como|con)|i am|i m|my name|i live|i work|uso|usamos|usa|usan|use|uses|decidimos|we decided|the rule is|la regla es|(mi|mis|my|our|nuestr[oa]s?) (\w+ ){1,4}(es|son|is|are))\b/;
const REQUEST =
  /^((che|bueno|dale|ok|okay|genial|perfecto|y|e|pero|entonces|and|but|so|well|hey|great) )*(podes|podrias|puedes|pueden|podrian|can|could|would|will|please|porfa|por favor|tenemos que|hay que|falta|faltaria|vamos a|lets|let s|we need to|need you to|necesito que|quiero que|fijate|solucion\w*|arregl\w*|termin\w*|complet\w*|hace|hacelo|revis\w*|renombr\w*|import\w*|fix|finish|do|check|run|make|try|go)\b/;
const TRANSIENT =
  /\b(hoy|ahora|ahi|recien|ayer|manana|esta vez|today|now|tonight|yesterday|tomorrow|this time|afk|creo que|me parece|no se|nose|i think|maybe|quizas|capaz)\b/;

/** Automatic capture keeps only standing facts: requests, questions and status updates expire with their chat. */
export function durableMemory(text: string): boolean {
  if (/[?¿]/.test(text)) return false;
  const plain = memoryPlain(text);
  if (POLICY.test(plain)) return true;
  return DURABLE.test(plain) && !REQUEST.test(plain) && !TRANSIENT.test(plain);
}
