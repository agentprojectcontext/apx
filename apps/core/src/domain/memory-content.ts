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
