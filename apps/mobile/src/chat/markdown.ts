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
  /** `lang`: what follows the opening backticks ("bash", "email"), lowercased; absent when nothing does. */
  | { kind: "code"; text: string; lang?: string }
  | { kind: "quote"; blocks: Block[] }
  | { kind: "table"; align: Align[]; header: Inline[][]; rows: Inline[][][] };

export type Align = "left" | "center" | "right";

const BULLET = /^\s*[-*•]\s+(.*)$/;
const NUMBERED = /^\s*(\d+)[.)]\s+(.*)$/;
const HEADING = /^(#{1,6})\s+(.*)$/;
const QUOTE = /^\s*>\s?(.*)$/;
const TABLE_DELIMITER = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

/** A row's cells: outer pipes are optional and `\|` is a pipe inside a cell. */
function tableCells(line: string): string[] {
  const row = line.trim().replace(/\\\|/g, "\uE000").replace(/^\|/, "").replace(/\|$/, "");
  return row.split("|").map((cell) => cell.trim().replace(/\uE000/g, "|"));
}

function tableRow(line: string, align: Align[]): Inline[][] {
  const cells = tableCells(line);
  return align.map((_, column) => parseInline(cells[column] ?? ""));
}

/** A GFM table starts with a header row whose cells match the delimiter row under it. */
function tableAt(lines: string[], i: number): Align[] | undefined {
  const header = lines[i] ?? "";
  const delimiter = lines[i + 1] ?? "";
  if (!header.includes("|") || !TABLE_DELIMITER.test(delimiter) || !delimiter.includes("-")) return undefined;
  const marks = tableCells(delimiter);
  if (marks.length !== tableCells(header).length) return undefined;
  if (marks.length < 2 && !delimiter.includes("|")) return undefined;
  return marks.map((mark) => (mark.endsWith(":") ? (mark.startsWith(":") ? "center" : "right") : "left"));
}

/** A link into the desktop panel ([Config › Desktop](apx:settings/desktop)): the phone keeps its label. */
const APP_LINK = /\[([^\]\n]+)\]\(apx:[^)\s]*\)/gi;

/** The common markdown agents write, as blocks; anything else stays plain text. */
export function parseMarkdown(source: string): Block[] {
  const lines = source.replace(/\r\n/g, "\n").replace(APP_LINK, "$1").split("\n");
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
      const lang = line.trim().slice(3).trim().split(/\s/)[0]?.toLowerCase();
      const code: string[] = [];
      for (i++; i < lines.length && !(lines[i] ?? "").trimStart().startsWith("```"); i++) code.push(lines[i] ?? "");
      blocks.push({ kind: "code", text: code.join("\n"), ...(lang ? { lang } : {}) });
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
    const align = tableAt(lines, i);
    if (align) {
      flush();
      // GFM: a row with fewer cells is padded, one with more is cut to the header's width.
      const header = tableRow(line, align);
      const rows: Inline[][][] = [];
      for (i += 2; i < lines.length && (lines[i] ?? "").includes("|") && (lines[i] ?? "").trim(); i++)
        rows.push(tableRow(lines[i] ?? "", align));
      i--;
      blocks.push({ kind: "table", align, header, rows });
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

const runsText = (runs: Inline[]): string =>
  runs.map((run) => ("children" in run ? runsText(run.children) : run.text)).join("");

/** What a copy carries: the words as they read on screen, without the marks (a link keeps its label). */
export function plainText(blocks: Block[]): string {
  return blocks
    .map((block) => {
      switch (block.kind) {
        case "list":
          return block.items.map((item) => `${item.marker} ${runsText(item.inline)}`).join("\n");
        case "code":
          return block.text;
        case "quote":
          return plainText(block.blocks);
        case "table":
          return [block.header, ...block.rows].map((row) => row.map(runsText).join("\t")).join("\n");
        default:
          return runsText(block.inline);
      }
    })
    .join("\n\n");
}

/** A message's lines as they read, without marks or list bullets: what a list row builds its title and preview from. */
export function plainLines(source: string): string[] {
  return plainText(parseMarkdown(source))
    .split("\n")
    .map((line) => line.replace(/^• /, "").replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

/** A chat list's one line: the words of a message, marks and line breaks gone. */
export const previewLine = (source: string): string => plainLines(source).join(" ");
