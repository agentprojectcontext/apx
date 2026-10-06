import { Fragment, type ReactElement, type ReactNode } from "react";
import { cx } from "../cx";

export interface MarkdownViewProps {
  /** Markdown source. Supported: paragraphs, line breaks, # headings, - and 1. lists, ``` code blocks, `code`, **bold**, *italic*, [links](https://…) and bare URLs. */
  source: string;
  size?: "sm" | "md";
  className?: string;
  /** Wraps each link (a right-click menu, for instance); `link` is the ready `<a>`. */
  renderLink?: LinkRenderer;
}

export type LinkRenderer = (href: string, link: ReactElement, key: string) => ReactNode;

type Block =
  | { kind: "p"; text: string }
  | { kind: "h"; level: number; text: string }
  | { kind: "ul" | "ol"; items: string[] }
  | { kind: "code"; text: string };

const SAFE_HREF = /^(https?:|mailto:)/i;
const INLINE =
  /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(\[[^\]\n]+\]\([^)\s]+\))|(\*[^*\s][^*\n]*\*)|(\b_[^_\s][^_\n]*_\b)|(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"])/g;

function parseBlocks(src: string): Block[] {
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) blocks.push({ kind: "p", text: para.join("\n") });
    para = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (line.trimStart().startsWith("```")) {
      flush();
      const code: string[] = [];
      i++;
      while (i < lines.length && !(lines[i] ?? "").trimStart().startsWith("```")) code.push(lines[i++] ?? "");
      blocks.push({ kind: "code", text: code.join("\n") });
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
      out.push(
        SAFE_HREF.test(href) ? (
          link(href, key, inline(lm?.[1] ?? "", key, wrap))
        ) : (
          <Fragment key={key}>{lm?.[1] ?? tok}</Fragment>
        ),
      );
    } else if (m[4] || m[5]) out.push(<em key={key}>{inline(tok.slice(1, -1), key, wrap)}</em>);
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
export function MarkdownView({ source, size = "md", className, renderLink }: MarkdownViewProps) {
  const blocks = parseBlocks(source);
  return (
    <div className={cx("apx-md", `apx-md--${size}`, className)}>
      {blocks.map((b, i) => {
        const k = `b${i}`;
        if (b.kind === "p") return <p key={k}>{inline(b.text, k, renderLink)}</p>;
        if (b.kind === "code")
          return (
            <pre key={k}>
              <code>{b.text}</code>
            </pre>
          );
        if (b.kind === "h") {
          const Tag = b.level <= 2 ? "h3" : "h4";
          return <Tag key={k}>{inline(b.text, k, renderLink)}</Tag>;
        }
        const List = b.kind;
        return (
          <List key={k}>
            {b.items.map((it, j) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: list items are positional
              <li key={j}>{inline(it, `${k}l${j}`, renderLink)}</li>
            ))}
          </List>
        );
      })}
    </div>
  );
}
