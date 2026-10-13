import { Fragment, type ReactElement, type ReactNode } from "react";
import { cx } from "../cx";
import { MENTION } from "../mention";

export interface MarkdownViewProps {
  /** Markdown source: paragraphs, headings, lists, quotes, code, emphasis, safe links and pipe tables. Raw HTML stays text. */
  source: string;
  size?: "sm" | "md";
  className?: string;
  /** Wraps each link (a right-click menu, for instance); `link` is the ready `<a>`. */
  renderLink?: LinkRenderer;
  /** Wraps each fenced code block (a run button, for instance); `lang` is the fence's word, lowercased. */
  renderCode?: CodeRenderer;
  /** Wraps each quote (a copy button, for instance: the quote's `innerText` is its words without the marks). */
  renderQuote?: QuoteRenderer;
}

export type LinkRenderer = (href: string, link: ReactElement, key: string) => ReactNode;
export type CodeRenderer = (code: string, lang: string | undefined, pre: ReactElement, key: string) => ReactNode;
export type QuoteRenderer = (quote: ReactElement, key: string) => ReactNode;

type Block =
  | { kind: "p"; text: string }
  | { kind: "h"; level: number; text: string }
  | { kind: "ul" | "ol"; items: string[] }
  | { kind: "code"; text: string; lang?: string | undefined }
  | { kind: "quote"; blocks: Block[] }
  | { kind: "table"; headers: string[]; rows: string[][]; align: ("left" | "center" | "right")[] };

function tableCells(line: string): string[] {
  const cells = line
    .trim()
    .replace(/^\|/, "")
    .replace(/(?<!\\)\|$/, "")
    .split(/(?<!\\)\|/);
  return cells.map((cell) => cell.trim().replace(/\\\|/g, "|"));
}

const QUOTE = /^\s*>\s?(.*)$/;
const SAFE_HREF = /^(https?:|mailto:)/i;
/** A link into the host app (apx:settings/desktop): only a renderLink can follow it; without one, its label stays. */
const APP_HREF = /^apx:[a-z]/i;
const MAX_TABLE_COLUMNS = 64;
const MAX_TABLE_CELLS = 10_000;
const INLINE = new RegExp(
  `${/(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(\[[^\]\n]+\]\([^)\s]+\))|(\*[^*\s][^*\n]*\*)|(\b_[^_\s][^_\n]*_\b)|(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"])/.source}|(${MENTION.source})`,
  "gu",
);

function parseBlocks(src: string): Block[] {
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let tableCellsLeft = MAX_TABLE_CELLS;
  let para: string[] = [];
  const flush = () => {
    if (para.length) blocks.push({ kind: "p", text: para.join("\n") });
    para = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (line.trimStart().startsWith("```")) {
      flush();
      const lang = /^```\s*([\w+-]+)/.exec(line.trimStart())?.[1]?.toLowerCase();
      const code: string[] = [];
      i++;
      while (i < lines.length && !(lines[i] ?? "").trimStart().startsWith("```")) code.push(lines[i++] ?? "");
      blocks.push({ kind: "code", text: code.join("\n"), lang });
      continue;
    }
    const separator = tableCells(lines[i + 1] ?? "");
    const headers = tableCells(line);
    if (
      line.includes("|") &&
      headers.length <= MAX_TABLE_COLUMNS &&
      headers.length <= tableCellsLeft &&
      separator.length === headers.length &&
      separator.every((s) => /^:?-{3,}:?$/.test(s))
    ) {
      flush();
      const align = separator.map((s): "left" | "center" | "right" =>
        s.endsWith(":") ? (s.startsWith(":") ? "center" : "right") : "left",
      );
      const rows: string[][] = [];
      i++;
      while (
        i + 1 < lines.length &&
        (rows.length + 2) * headers.length <= tableCellsLeft &&
        (lines[i + 1] ?? "").includes("|")
      )
        rows.push(tableCells(lines[++i] ?? ""));
      blocks.push({ kind: "table", headers, rows, align });
      tableCellsLeft -= (rows.length + 1) * headers.length;
      continue;
    }
    if (QUOTE.test(line)) {
      flush();
      // Quoted lines (blank `>` lines included) are one quote holding blocks of its own.
      const quoted: string[] = [];
      for (; i < lines.length && QUOTE.test(lines[i] ?? ""); i++) quoted.push(QUOTE.exec(lines[i] ?? "")?.[1] ?? "");
      i--;
      blocks.push({ kind: "quote", blocks: parseBlocks(quoted.join("\n")) });
      continue;
    }
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) {
      flush();
      blocks.push({ kind: "h", level: h[1]?.length ?? 1, text: h[2] ?? "" });
      continue;
    }
    const ul = /^\s*[-*•]\s+(.*)$/.exec(line);
    const ol = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (ul || ol) {
      flush();
      const kind = ul ? "ul" : "ol";
      const last = blocks[blocks.length - 1];
      const text = (ul ?? ol)?.[1] ?? "";
      if (last && last.kind === kind) last.items.push(text);
      else blocks.push({ kind, items: [text] });
      continue;
    }
    if (!line.trim()) {
      flush();
      continue;
    }
    para.push(line);
  }
  flush();
  return blocks;
}

function inline(text: string, keyBase: string, wrap?: LinkRenderer): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let n = 0;
  const link = (href: string, key: string, body: ReactNode) => {
    const a = (
      <a key={key} href={href} target="_blank" rel="noopener noreferrer">
        {body}
      </a>
    );
    return wrap ? <Fragment key={key}>{wrap(href, a, key)}</Fragment> : a;
  };
  for (const m of text.matchAll(INLINE)) {
    const at = m.index ?? 0;
    if (at > last) out.push(breaks(text.slice(last, at), `${keyBase}t${n}`));
    const tok = m[0];
    const key = `${keyBase}i${n++}`;
    if (m[1]) out.push(<code key={key}>{tok.slice(1, -1)}</code>);
    else if (m[2]) out.push(<strong key={key}>{inline(tok.slice(2, -2), key, wrap)}</strong>);
    else if (m[3]) {
      const lm = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(tok);
      const href = lm?.[2] ?? "";
      const body = inline(lm?.[1] ?? "", key, wrap);
      out.push(
        SAFE_HREF.test(href) ? (
          link(href, key, body)
        ) : APP_HREF.test(href) && wrap ? (
          <Fragment key={key}>{wrap(href, <a href={href}>{body}</a>, key)}</Fragment>
        ) : (
          <Fragment key={key}>{lm?.[1] ?? tok}</Fragment>
        ),
      );
    } else if (m[4] || m[5]) out.push(<em key={key}>{inline(tok.slice(1, -1), key, wrap)}</em>);
    else if (m[7])
      out.push(
        <span key={key} className="apx-mention">
          {tok}
        </span>,
      );
    else out.push(link(tok, key, tok));
    last = at + tok.length;
  }
  if (last < text.length) out.push(breaks(text.slice(last), `${keyBase}t${n}`));
  return out;
}

function breaks(text: string, key: string): ReactNode {
  const parts = text.split("\n");
  if (parts.length === 1) return text;
  return (
    <Fragment key={key}>
      {parts.map((p, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: static split of one text node
        <Fragment key={i}>
          {i > 0 && <br />}
          {p}
        </Fragment>
      ))}
    </Fragment>
  );
}

/** Small, safe Markdown renderer for agent text (no raw HTML, http/mailto links only, new tab). */
export function MarkdownView({
  source,
  size = "md",
  className,
  renderLink,
  renderCode,
  renderQuote,
}: MarkdownViewProps) {
  const blocks = parseBlocks(source);
  return (
    <div className={cx("apx-md", `apx-md--${size}`, className)}>
      {renderBlocks(blocks, "b", { renderLink, renderCode, renderQuote })}
    </div>
  );
}

type Renderers = Pick<MarkdownViewProps, "renderLink" | "renderCode" | "renderQuote">;

function renderBlocks(blocks: Block[], prefix: string, r: Renderers): ReactNode[] {
  const renderLink = r.renderLink;
  return blocks.map((b, i) => {
    const k = `${prefix}${i}`;
    if (b.kind === "p") return <p key={k}>{inline(b.text, k, renderLink)}</p>;
    if (b.kind === "quote") {
      const quote = (
        <blockquote key={k} className="apx-md__quote">
          {renderBlocks(b.blocks, `${k}q`, r)}
        </blockquote>
      );
      return r.renderQuote ? <Fragment key={k}>{r.renderQuote(quote, k)}</Fragment> : quote;
    }
    if (b.kind === "code") {
      const pre = (
        <pre key={k}>
          <code>{b.text}</code>
        </pre>
      );
      return r.renderCode ? <Fragment key={k}>{r.renderCode(b.text, b.lang, pre, k)}</Fragment> : pre;
    }
    if (b.kind === "h") {
      const Tag = b.level <= 2 ? "h3" : "h4";
      return <Tag key={k}>{inline(b.text, k, renderLink)}</Tag>;
    }
    if (b.kind === "table")
      return (
        <div key={k} className="apx-md__table">
          <table>
            <thead>
              <tr>
                {b.headers.map((cell, j) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: table columns are positional
                  <th key={j} scope="col" style={{ textAlign: b.align[j] }}>
                    {inline(cell, `${k}h${j}`, renderLink)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {b.rows.map((row, ri) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: table rows are positional
                <tr key={ri}>
                  {b.headers.map((_, j) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: table columns are positional
                    <td key={j} style={{ textAlign: b.align[j] }}>
                      {inline(row[j] ?? "", `${k}r${ri}c${j}`, renderLink)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    const List = b.kind;
    return (
      <List key={k}>
        {b.items.map((it, j) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: list items are positional
          <li key={j}>{inline(it, `${k}l${j}`, renderLink)}</li>
        ))}
      </List>
    );
  });
}
