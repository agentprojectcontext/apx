/** Inline runs of a line: plain, bold, italic, code or a link. */
export type Inline =
  | { kind: "text"; text: string }
  | { kind: "bold"; children: Inline[] }
  | { kind: "italic"; children: Inline[] }
  | { kind: "code"; text: string }
  | { kind: "link"; text: string; url: string };

/** The blocks an agent's answer is made of. */
export type Block =
  | { kind: "paragraph"; inline: Inline[] }
  | { kind: "heading"; level: number; inline: Inline[] }
  | { kind: "list"; ordered: boolean; items: Array<{ marker: string; inline: Inline[] }> }
  | { kind: "code"; text: string }
  | { kind: "quote"; blocks: Block[] };

const BULLET = /^\s*[-*•]\s+(.*)$/;
const NUMBERED = /^\s*(\d+)[.)]\s+(.*)$/;
const HEADING = /^(#{1,6})\s+(.*)$/;
const QUOTE = /^\s*>\s?(.*)$/;

/** The common markdown agents write, as blocks; anything else stays plain text. */
export function parseMarkdown(source: string): Block[] {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length) blocks.push({ kind: "paragraph", inline: parseInline(paragraph.join("\n")) });
    paragraph = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (line.trimStart().startsWith("```")) {
      flush();
      const code: string[] = [];
      for (i++; i < lines.length && !(lines[i] ?? "").trimStart().startsWith("```"); i++) code.push(lines[i] ?? "");
      blocks.push({ kind: "code", text: code.join("\n") });
      continue;
    }
    if (QUOTE.test(line)) {
      flush();
      const quoted: string[] = [];
      for (; i < lines.length && QUOTE.test(lines[i] ?? ""); i++) quoted.push(QUOTE.exec(lines[i] ?? "")?.[1] ?? "");
      i--;
      blocks.push({ kind: "quote", blocks: parseMarkdown(quoted.join("\n")) });
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      flush();
      blocks.push({ kind: "heading", level: heading[1]?.length ?? 1, inline: parseInline(heading[2] ?? "") });
      continue;
    }
    const bullet = BULLET.exec(line);
    const numbered = NUMBERED.exec(line);
    if (bullet || numbered) {
      flush();
      const ordered = Boolean(numbered);
      const item = {
        marker: numbered ? `${numbered[1]}.` : "•",
        inline: parseInline((numbered?.[2] ?? bullet?.[1]) || ""),
      };
      const last = blocks.at(-1);
      if (last?.kind === "list" && last.ordered === ordered) last.items.push(item);
      else blocks.push({ kind: "list", ordered, items: [item] });
      continue;
    }
    if (!line.trim()) {
      flush();
      continue;
    }
    paragraph.push(line);
  }
  flush();
  return blocks;
}

const INLINE = /(\*\*([^*]+?)\*\*|__([^_]+?)__|`([^`]+)`|\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)|\*([^*\s][^*]*?)\*)/;

/** Bold, *italic*, inline code and links inside one block; unmatched marks (and snake_case) stay as they are. */
export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  let rest = text;
  while (rest) {
    const m = INLINE.exec(rest);
    if (!m) {
      out.push({ kind: "text", text: rest });
      break;
    }
    if (m.index > 0) out.push({ kind: "text", text: rest.slice(0, m.index) });
    const [whole, , bold, bold2, code, linkText, url, italic] = m;
    if (bold ?? bold2) out.push({ kind: "bold", children: parseInline(bold ?? bold2 ?? "") });
    else if (code !== undefined) out.push({ kind: "code", text: code });
    else if (linkText && url) out.push({ kind: "link", text: linkText, url });
    else out.push({ kind: "italic", children: parseInline(italic ?? "") });
    rest = rest.slice(m.index + whole.length);
  }
  return out;
}
