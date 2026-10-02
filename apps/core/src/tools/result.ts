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

/** Marks text that came from outside (web, other agents, widgets) as data, not instructions. */
export function untrusted(source: string, attrs: Record<string, string>, body: string): string {
  const a = Object.entries(attrs)
    .map(([k, v]) => ` ${k}="${v.replace(/["<>]/g, "'")}"`)
    .join("");
  // The body cannot close its own envelope or pose as APX or the owner.
  const safe = body.replace(new RegExp(`<(/?)(${source}|${RESERVED_TAGS})\\b`, "gi"), "&lt;$1$2");
  return `<${source}${a} ${UNTRUSTED_MARK}>\n${safe}\n</${source}>`;
}
