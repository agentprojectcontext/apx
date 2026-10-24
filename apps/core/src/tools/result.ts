// Every tool result entering the model context is capped and checked for binary content.
const RESULT_CAP = 12_000;

function looksBinary(text: string): boolean {
  const head = text.slice(0, 2000);
  for (let i = 0; i < head.length; i++) {
    const c = head.charCodeAt(i);
    if (c < 9 || (c > 13 && c < 32)) return true;
  }
  return false;
}

export function cap(text: string, max = RESULT_CAP): string {
  if (looksBinary(text)) return "[binary content omitted]";
  if (text.length <= max) return text;
  // Head and tail: the end of a page or a log is often where the answer is.
  const head = Math.floor(max * 0.75);
  const tail = max - head;
  return `${text.slice(0, head)}\n…[${text.length - max} chars omitted]…\n${text.slice(-tail)}`;
}

/** What every untrusted envelope carries: finding it in a turn's context means outside content is there. */
export const UNTRUSTED_MARK = 'trust="untrusted"';

// Tags only APX writes: outside text that carries them is defused.
const RESERVED_TAGS = "system_note|owner_instruction";

/**
 * A name from outside (a contact's, a room's) set inside a sentence APX writes: one line, no tags or quotes, capped,
 * so it cannot start a line of its own or pose as markup.
 */
export function inlineName(name: string, max = 60): string {
  return oneLine(name)
    .replace(/[<>]/g, "")
    .replace(/"/g, "'")
    .replace(/\s{2,}/g, " ")
    .trim()
    .slice(0, max);
}

// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what is stripped.
const oneLine = (text: string) => text.replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, " ");

/**
 * Marks text that came from outside (web, contacts, outside apps, widgets) as data, not instructions. Every `<` in it
 * is escaped, so it cannot open any envelope of its own (a contact writing `<agent_message trust="team">`).
 */
export function untrusted(source: string, attrs: Record<string, string>, body: string): string {
  return envelope(source, attrs, body.replace(/</g, "&lt;"), UNTRUSTED_MARK);
}

/**
 * Text one of the owner's own agents wrote (a request, a delegated answer, a task it made): the owner's side, so it
 * does not count as outside content (DECISIONS.md#d-071). Still enveloped, so it cannot pose as APX or the owner.
 */
export function fromTeam(source: string, attrs: Record<string, string>, body: string): string {
  return envelope(source, attrs, body, 'trust="team"');
}

function envelope(source: string, attrs: Record<string, string>, body: string, mark: string): string {
  const a = Object.entries(attrs)
    .map(([k, v]) => ` ${k}="${oneLine(v).replace(/["<>]/g, "'")}"`)
    .join("");
  // The body cannot close its own envelope or pose as APX or the owner.
  const safe = body.replace(new RegExp(`<(/?)(${source}|${RESERVED_TAGS})\\b`, "gi"), "&lt;$1$2");
  return `<${source}${a} ${mark}>\n${safe}\n</${source}>`;
}
