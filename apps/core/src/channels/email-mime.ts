// Reading a raw email (RFC 5322 + MIME) into what the agent needs: who wrote, the thread headers, the words without
// the quoted history, and the attachments. Everything here is outside content: sizes and depths are capped.

const MAX_PARTS = 60;
const MAX_DEPTH = 8;

export type Headers = Map<string, string[]>;

export type MailPart = { name: string; mime: string; data: Buffer };

export type ParsedMail = {
  headers: Headers;
  /** The plain text (from text/plain, else the HTML as text), quoted history not yet removed. */
  text: string;
  attachments: MailPart[];
  /** Attachments the message announced but that were cut by the size cap. */
  truncated: boolean;
};

/** The first value of a header (names are case-insensitive). */
export const header = (h: Headers, name: string): string | undefined => h.get(name.toLowerCase())?.[0];

/** Headers (unfolded) and where the body starts. */
export function splitMessage(raw: Buffer): { headers: Headers; body: Buffer } {
  let end = raw.indexOf("\r\n\r\n");
  let skip = 4;
  const lf = raw.indexOf("\n\n");
  if (end < 0 || (lf >= 0 && lf < end)) {
    end = lf;
    skip = 2;
  }
  if (end < 0) return { headers: parseHeaders(raw.toString("latin1")), body: Buffer.alloc(0) };
  return { headers: parseHeaders(raw.subarray(0, end).toString("latin1")), body: raw.subarray(end + skip) };
}

function parseHeaders(text: string): Headers {
  const out: Headers = new Map();
  const unfolded = text.replace(/\r?\n[ \t]+/g, " ");
  for (const line of unfolded.split(/\r?\n/)) {
    const colon = line.indexOf(":");
    if (colon <= 0) continue;
    const name = line.slice(0, colon).trim().toLowerCase();
    // Raw 8-bit headers are usually UTF-8; decoding them is best effort.
    const value = Buffer.from(line.slice(colon + 1).trim(), "latin1").toString("utf8");
    out.set(name, [...(out.get(name) ?? []), value]);
  }
  return out;
}

/** RFC 2047 encoded words ("=?UTF-8?B?…?=") as text; spaces between two encoded words go away. */
export function decodeWords(s: string): string {
  return s
    .replace(/(=\?[^?]+\?[bBqQ]\?[^?]*\?=)\s+(?==\?[^?]+\?[bBqQ]\?[^?]*\?=)/g, "$1")
    .replace(/=\?([^?*]+)(?:\*[^?]*)?\?([bBqQ])\?([^?]*)\?=/g, (_m, charset: string, enc: string, data: string) => {
      const bytes =
        enc.toUpperCase() === "B"
          ? Buffer.from(data, "base64")
          : qp(Buffer.from(data.replace(/_/g, " "), "latin1"), false);
      return charsetText(bytes, charset);
    });
}

/** The first address of a From/To/Reply-To header: lower-cased address and the display name, if any. */
export function parseAddress(value: string | undefined): { address: string; name: string } | undefined {
  if (!value) return undefined;
  const v = decodeWords(value);
  const angle = /<\s*([^<>\s]+@[^<>\s]+)\s*>/.exec(v);
  const address = (angle?.[1] ?? /([^\s<>",;:()]+@[^\s<>",;:()]+)/.exec(v)?.[1])?.toLowerCase();
  if (!address || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(address)) return undefined;
  const name = angle
    ? v
        .slice(0, angle.index)
        .replace(/^[\s"']+|[\s"',]+$/g, "")
        .replace(/\\(.)/g, "$1")
    : "";
  return { address, name: name.replace(/[\p{Cc}\p{Cf}]/gu, "").slice(0, 80) };
}

/** Message ids in a header ("<a@b> <c@d>"), as written. */
export const messageIds = (value: string | undefined): string[] => (value ?? "").match(/<[^<>\s]+>/g) ?? [];

type ContentType = { type: string; params: Record<string, string> };

function contentType(value: string | undefined): ContentType {
  const [type = "text/plain", ...rest] = splitParams(value ?? "text/plain");
  const params: Record<string, string> = {};
  for (const p of rest) {
    const eq = p.indexOf("=");
    if (eq <= 0) continue;
    const key = p.slice(0, eq).trim().toLowerCase();
    const val = p
      .slice(eq + 1)
      .trim()
      .replace(/^"(.*)"$/s, "$1");
    // RFC 2231: filename*=utf-8''r%C3%A9sum%C3%A9.pdf, and continuations (filename*0*=…, filename*1*=…) in order.
    const ext = /^([^*]+)(?:\*(\d+))?(\*)?$/.exec(key);
    if (ext?.[1] && (ext[2] !== undefined || ext[3])) {
      let v = val;
      if (ext[3]) {
        const cm = /^([^']*)'[^']*'(.*)$/s.exec(v);
        const first = cm && (ext[2] === undefined || ext[2] === "0");
        v = charsetText(percentBytes(first ? (cm[2] ?? "") : v), first ? cm[1] || "utf-8" : "utf-8");
      }
      params[ext[1]] = (params[ext[1]] ?? "") + v;
    } else params[key] = decodeWords(val);
  }
  return { type: type.trim().toLowerCase(), params };
}

const percentBytes = (s: string) =>
  Buffer.from(
    s.replace(/%([0-9a-f]{2})/gi, (_m, h: string) => String.fromCharCode(Number.parseInt(h, 16))),
    "latin1",
  );

function splitParams(v: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (const c of v) {
    if (c === '"') quoted = !quoted;
    if (c === ";" && !quoted) {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out;
}

/** Quoted-printable bytes decoded; `soft` line breaks ("=\r\n") are joined. */
function qp(b: Buffer, soft = true): Buffer {
  const s = b.toString("latin1");
  const text = soft ? s.replace(/=\r?\n/g, "") : s;
  return Buffer.from(
    text.replace(/=([0-9A-Fa-f]{2})/g, (_m, h: string) => String.fromCharCode(Number.parseInt(h, 16))),
    "latin1",
  );
}

function decodeBody(b: Buffer, encoding: string | undefined): Buffer {
  const e = (encoding ?? "").trim().toLowerCase();
  if (e === "base64") return Buffer.from(b.toString("latin1").replace(/[^A-Za-z0-9+/=]/g, ""), "base64");
  if (e === "quoted-printable") return qp(b);
  return b;
}

/** Bytes in a charset as text; an unknown charset is read as UTF-8 (then Latin-1 if that fails). */
export function charsetText(b: Buffer, charset: string | undefined): string {
  const cs = (charset ?? "utf-8").trim().toLowerCase();
  try {
    return new TextDecoder(cs === "us-ascii" || cs === "ascii" ? "utf-8" : cs).decode(b);
  } catch {
    const utf8 = b.toString("utf8");
    return utf8.includes("�") ? b.toString("latin1") : utf8;
  }
}

/** The parts of a message: the text the agent reads and the files it carries. */
export function parseMail(raw: Buffer, truncated = false): ParsedMail {
  const { headers, body } = splitMessage(raw);
  const plain: string[] = [];
  const html: string[] = [];
  const attachments: MailPart[] = [];
  let count = 0;

  const walk = (h: Headers, b: Buffer, depth: number) => {
    if (++count > MAX_PARTS || depth > MAX_DEPTH) return;
    const ct = contentType(header(h, "content-type"));
    if (ct.type.startsWith("multipart/")) {
      const boundary = ct.params.boundary;
      if (!boundary) return;
      const parts = splitMultipart(b, boundary);
      // An alternative offers the same words twice: the plain one when there is one.
      if (ct.type === "multipart/alternative") {
        const parsed = parts.map((p) => splitMessage(p));
        const pick =
          parsed.find((p) => contentType(header(p.headers, "content-type")).type === "text/plain") ??
          parsed.find((p) => contentType(header(p.headers, "content-type")).type === "text/html") ??
          parsed[0];
        if (pick) walk(pick.headers, pick.body, depth + 1);
        for (const p of parsed)
          if (p !== pick && !contentType(header(p.headers, "content-type")).type.startsWith("text/"))
            walk(p.headers, p.body, depth + 1);
        return;
      }
      for (const p of parts) {
        const s = splitMessage(p);
        walk(s.headers, s.body, depth + 1);
      }
      return;
    }
    const disposition = contentType(header(h, "content-disposition"));
    const name = disposition.params.filename ?? ct.params.name;
    const data = decodeBody(b, header(h, "content-transfer-encoding"));
    const inline = disposition.type !== "attachment" && !name;
    if (inline && ct.type === "text/plain") plain.push(charsetText(data, ct.params.charset));
    else if (inline && ct.type === "text/html") html.push(charsetText(data, ct.params.charset));
    else
      attachments.push({
        name: (name ?? (ct.type === "message/rfc822" ? "message.eml" : "attachment")).replace(/[\\/\p{Cc}]/gu, "_"),
        mime: ct.type,
        data,
      });
  };
  walk(headers, body, 0);
  const text = plain.length ? plain.join("\n\n") : html.map(htmlToText).join("\n\n");
  return { headers, text, attachments, truncated };
}

function splitMultipart(b: Buffer, boundary: string): Buffer[] {
  const s = b.toString("latin1");
  const delim = `--${boundary}`;
  const out: Buffer[] = [];
  let i = s.indexOf(delim);
  while (i >= 0) {
    const start = s.indexOf("\n", i);
    if (start < 0 || s.startsWith(`${delim}--`, i)) break;
    const next = s.indexOf(`\n${delim}`, start);
    const end = next < 0 ? s.length : next;
    out.push(Buffer.from(s.slice(start + 1, end > 0 && s[end - 1] === "\r" ? end - 1 : end), "latin1"));
    i = next < 0 ? -1 : next + 1;
  }
  return out;
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  laquo: "«",
  raquo: "»",
  iexcl: "¡",
  iquest: "¿",
};

/** HTML as plain text: no scripts or styles, blocks as lines, links keep their address, entities decoded. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|head|title)\b[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<blockquote\b[\s\S]*?<\/blockquote\s*>/gi, "\n")
    .replace(
      /<a\b[^>]*href\s*=\s*["']?([^"'\s>]+)["']?[^>]*>([\s\S]*?)<\/a\s*>/gi,
      (_m, href: string, label: string) =>
        /^https?:/i.test(href) && !label.includes(href) ? `${label} (${href})` : label,
    )
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6]|table|ul|ol)\s*>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, "")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
      if (e[0] === "#") {
        const n = e[1] === "x" || e[1] === "X" ? Number.parseInt(e.slice(2), 16) : Number(e.slice(1));
        return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : "";
      }
      return ENTITIES[e.toLowerCase()] ?? m;
    })
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Where the quoted history starts: "On … wrote:", Outlook's header block, a forwarded-message line. */
const QUOTE_INTRO = [
  /^(On|El|Le|Am|Il|Em|Op)\s.{4,200}(wrote|escribió|a écrit|schrieb|ha scritto|escreveu|schreef)\s*:\s*$/i,
  /^-{2,}\s*(Original Message|Mensaje original|Message d'origine|Ursprüngliche Nachricht)\s*-{2,}\s*$/i,
  /^_{10,}\s*$/,
  /^(From|De|Von|Da):\s.+$/,
];

/** The new words of a reply: without the quoted history, `>` lines and the signature after "-- ". */
export function stripQuoted(text: string): string {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (line === "-- " || line === "--") break;
    // "On Mon, … <x@y>\nwrote:" wraps over two lines in many clients.
    const two = `${line} ${lines[i + 1] ?? ""}`.trim();
    if (QUOTE_INTRO.some((r) => r.test(line.trim())) || (/^(On|El)\s/.test(line) && QUOTE_INTRO[0]?.test(two))) {
      // An Outlook "From:" line is history only when the block under it looks like a header block.
      if (
        /^(From|De|Von|Da):/.test(line.trim()) &&
        !/^(Sent|Enviado|To|Para|Date|Fecha|Subject|Asunto):/m.test(lines.slice(i + 1, i + 4).join("\n"))
      )
        out.push(line);
      else break;
      continue;
    }
    if (/^\s*>/.test(line)) continue;
    out.push(line);
  }
  return out
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
