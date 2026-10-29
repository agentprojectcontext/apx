// A signature brought from Gmail: Gmail keeps it as rich HTML (styles, tables, fonts), and APX keeps only a small
// inert subset (safeSignatureHtml). What fits is kept, the rest gives way to its text; nothing is saved here.
import { safeSignatureHtml } from "@apx/protocol";

const KEEP = new Set(["p", "div", "span", "b", "strong", "em", "i", "u", "br", "a", "img"]);
/** Layout tags Gmail's editor uses for lines and cells, kept as the nearest allowed one. */
const AS: Record<string, string> = { tr: "div", li: "div", h1: "div", h2: "div", h3: "div", td: "span", font: "span" };
/** Tags whose content is never text of the signature. */
const DROP = new Set(["script", "style", "head", "title", "template", "noscript", "svg"]);
const BLOCK = new Set(["p", "div", "tr", "li", "h1", "h2", "h3", "table"]);
const VOID = new Set(["br", "img", "hr", "meta", "link", "input", "wbr", "col"]);
const ATTRS: Record<string, readonly string[]> = {
  a: ["href", "title"],
  img: ["src", "alt", "title", "width", "height"],
};

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  middot: "·",
  bull: "•",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  copy: "©",
  reg: "®",
};
const decode = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, e: string) => {
    if (e[0] !== "#") return ENTITIES[e.toLowerCase()] ?? all;
    const code = e[1] === "x" || e[1] === "X" ? Number.parseInt(e.slice(2), 16) : Number(e.slice(1));
    return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : all;
  });
const escapeText = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** An attribute APX accepts as it is, or undefined. */
function attrValue(tag: string, key: string, raw: string): string | undefined {
  if (!ATTRS[tag]?.includes(key)) return undefined;
  const value = decode(raw).trim();
  if (/["<>]/.test(value)) return undefined;
  if (key === "width" || key === "height") return /^[1-9]\d{0,3}$/.test(value) ? value : undefined;
  if (key !== "href" && key !== "src") return value;
  return safeSignatureHtml(`<${tag} ${key}="${value}">${tag === "a" ? "</a>" : ""}`) ? value : undefined;
}

/** Gmail's signature HTML as APX's subset and as plain text; `html` is absent when only text remains. */
export function importedSignature(source: string): { text: string; html?: string } {
  const out: string[] = [];
  const text: string[] = [];
  const open: string[] = [];
  let dropping = 0;
  const line = () => {
    if (text.length && !text.at(-1)?.endsWith("\n")) text.push("\n");
  };
  for (const m of source.replace(/<!--[\s\S]*?-->/g, "").matchAll(/<(\/?)([a-z][a-z0-9]*)([^>]*)>|([^<]+)/gi)) {
    const [, close, rawName, attrs, words] = m;
    if (words !== undefined) {
      if (dropping) continue;
      const plain = decode(words).replace(/\s+/g, " ");
      if (!plain.trim() && !text.length) continue;
      text.push(plain);
      out.push(escapeText(plain));
      continue;
    }
    const name = (rawName ?? "").toLowerCase();
    if (DROP.has(name)) {
      if (!VOID.has(name)) dropping += close ? -1 : 1;
      dropping = Math.max(0, dropping);
      continue;
    }
    if (dropping) continue;
    if (name === "br") {
      text.push("\n");
      out.push("<br>");
      continue;
    }
    if (BLOCK.has(name)) line();
    const tag = KEEP.has(name) ? name : AS[name];
    if (!tag) continue;
    if (close) {
      const at = open.lastIndexOf(tag);
      if (at < 0) continue;
      for (const t of open.splice(at).reverse()) out.push(`</${t}>`);
      continue;
    }
    const kept: string[] = [];
    for (const a of (attrs ?? "").matchAll(/([a-z-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/gi)) {
      const key = (a[1] ?? "").toLowerCase();
      const value = attrValue(tag, key, a[2] ?? a[3] ?? a[4] ?? "");
      if (value !== undefined && !kept.some((k) => k.startsWith(`${key}=`))) kept.push(`${key}="${value}"`);
    }
    if (tag === "img") {
      // Gmail sizes images by style; its pixel width and height become the attributes APX keeps.
      const style = /\bstyle\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(attrs ?? "");
      for (const side of ["width", "height"])
        if (!kept.some((k) => k.startsWith(`${side}=`))) {
          const px = new RegExp(`(?:^|;)\\s*${side}\\s*:\\s*(\\d{1,4})(?:\\.\\d+)?px`, "i").exec(
            decode(style?.[1] ?? style?.[2] ?? ""),
          )?.[1];
          if (px && attrValue("img", side, px)) kept.push(`${side}="${px}"`);
        }
      if (kept.some((k) => k.startsWith("src="))) out.push(`<img ${kept.join(" ")}>`);
      continue;
    }
    // Twenty open tags is APX's limit: deeper nesting keeps its text, not its tags.
    if (open.length >= 19) continue;
    open.push(tag);
    out.push(kept.length ? `<${tag} ${kept.join(" ")}>` : `<${tag}>`);
  }
  for (const t of open.reverse()) out.push(`</${t}>`);
  const plain = text
    .join("")
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, 10_000);
  const html = out.join("").trim();
  return html && /<[a-z]/i.test(html) && html.length <= 30_000 && safeSignatureHtml(html)
    ? { text: plain, html }
    : { text: plain };
}
