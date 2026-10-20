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
