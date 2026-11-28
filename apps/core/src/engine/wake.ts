// Whether a short clip a listening phone or computer heard is the voice's name ("ok Roby", "che Roby").
// Words, not loose text: whisper writes "ok ro bi" and that counts, but "Roby said ok" must not wake it. A call word
// and the name, together, near the start. See DECISIONS.md#d-285

/** What whisper writes for the usual call words: each one counts as any other. */
const CALLS = ["ok", "oka", "okey", "okay", "okei", "oc", "o", "hey", "ey", "eh", "che", "hola", "oye", "hi"];

/** The phrases that wake the voice when the owner set none: a call word and the super-agent's name. */
export function defaultWakeWords(name: string): string[] {
  const n = name.trim();
  return n ? [`ok ${n}`, `che ${n}`, `hey ${n}`] : [];
}

/** Lower case, no accents or punctuation. */
function plain(s: string): string {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** How a name sounds, roughly: "Robbie", "Roby" and "Robi" are one name to the ear. */
function sound(word: string): string {
  return word
    .replace(/ie$|y$|ee$|ey$/, "i")
    .replace(/(.)\1+/g, "$1")
    .replace(/h/g, "")
    .replace(/v/g, "b")
    .replace(/z/g, "s");
}

function distance(a: string, b: string): number {
  if (a === b) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++)
      cur[j] = Math.min(
        (prev[j] ?? 0) + 1,
        (cur[j - 1] ?? 0) + 1,
        (prev[j - 1] ?? 0) + (a[i - 1] !== b[j - 1] ? 1 : 0),
      );
    prev = cur;
  }
  return prev[b.length] ?? 0;
}

/** The phrase heard ("ok roby"), or undefined when the words are not one of the wake phrases. */
export function wakeMatch(text: string, phrases: readonly string[]): string | undefined {
  const words = plain(text).split(" ").filter(Boolean);
  if (!words.length || words.length > 8) return undefined;
  const calls = new Set(CALLS);
  const names = new Set<string>();
  for (const p of phrases) {
    const parts = plain(p).split(" ").filter(Boolean);
    if (parts.length >= 2) {
      calls.add(parts[0] ?? "");
      names.add(sound(parts.slice(1).join("")));
    } else if (parts[0]) names.add(sound(parts[0]));
  }
  for (let i = 0; i < Math.min(3, words.length); i++) {
    // Said fast, the call word and the name come out as one word ("cheroby", "okroby").
    const glued = sound(words[i] ?? "");
    for (const c of calls) {
      const call = sound(c);
      if (call.length < 2 || !glued.startsWith(call)) continue;
      for (const n of names)
        if (distance(glued.slice(call.length), n) <= Math.max(1, Math.floor(n.length / 5))) return `${c} ${n}`;
    }
    if (!calls.has(words[i] ?? "")) continue;
    // The name may come split in two ("ro bi") or with a comma's pause turned into a word.
    for (const join of [1, 2]) {
      if (i + join >= words.length) break;
      const heard = sound(words.slice(i + 1, i + 1 + join).join(""));
      for (const n of names)
        if (distance(heard, n) <= Math.max(1, Math.floor(n.length / 5))) return `${words[i]} ${heard}`;
    }
  }
  return undefined;
}
