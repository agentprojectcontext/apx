import { Fragment, type ReactNode } from "react";
import { cn } from "../../lib/cn";
import { toneText, toneTextHover } from "../../lib/tone";

// A small, dependency-free markdown renderer. We deliberately avoid
// react-markdown/marked (no installers per project rules) and never use
// dangerouslySetInnerHTML — every node is a real React element, so untrusted
// document content can't inject markup. Coverage is the common subset:
// headings, fenced/inline code, bold/italic/links, blockquotes, hr, and
// ordered/unordered lists. Anything else renders as plain paragraphs.

// A group @mention, styled as a soft neutral chip (not a loud colour) so it
// reads as a handle in any theme. Exported so a literal (non-markdown) bubble —
// the user's own — can highlight mentions the same way.
export function MentionChip({ handle }: { handle: string }) {
  return (
    <span className="rounded bg-foreground/[0.07] px-1 font-medium text-foreground/90 dark:bg-foreground/10">
      {handle}
    </span>
  );
}

// ── Inline: bold, italic, code, links, (optional) @mentions ─────────────────
function renderInline(text: string, keyBase: string, mentions = false): ReactNode[] {
  const out: ReactNode[] = [];
  // One regex, alternation ordered so `**` beats `*`. Groups capture the inner.
  // The trailing @mention group is only STYLED when `mentions` is on; otherwise
  // it renders as the literal text, so ordinary markdown is unchanged.
  const re = /(\*\*([^*]+)\*\*)|(\*([^*]+)\*)|(`([^`]+)`)|(\[([^\]]+)\]\(([^)]+)\))|((?<![\w])@[\p{L}\p{N}_-]+)/gu;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(<Fragment key={`${keyBase}-t${i}`}>{text.slice(last, m.index)}</Fragment>);
    if (m[2] !== undefined) out.push(<strong key={`${keyBase}-b${i}`}>{m[2]}</strong>);
    else if (m[4] !== undefined) out.push(<em key={`${keyBase}-i${i}`}>{m[4]}</em>);
    else if (m[6] !== undefined)
      out.push(<code key={`${keyBase}-c${i}`} className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]">{m[6]}</code>);
    else if (m[8] !== undefined)
      out.push(
        <a key={`${keyBase}-l${i}`} href={m[9]} target="_blank" rel="noreferrer" className={`underline underline-offset-2 ${toneText.sky} ${toneTextHover.sky}`}>
          {m[8]}
        </a>,
      );
    else if (m[10] !== undefined)
      out.push(mentions
        ? <MentionChip key={`${keyBase}-m${i}`} handle={m[10]} />
        : <Fragment key={`${keyBase}-m${i}`}>{m[10]}</Fragment>);
    last = re.lastIndex;
    i += 1;
  }
  if (last < text.length) out.push(<Fragment key={`${keyBase}-tend`}>{text.slice(last)}</Fragment>);
  return out;
}

// Highlight @mentions in a literal (non-markdown) string — the user's own
// bubble, which stays verbatim so we don't run it through the markdown parser.
export function renderMentions(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(?<![\w])@[\p{L}\p{N}_-]+/gu;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(<Fragment key={`u-t${i}`}>{text.slice(last, m.index)}</Fragment>);
    out.push(<MentionChip key={`u-m${i}`} handle={m[0]} />);
    last = re.lastIndex;
    i += 1;
  }
  if (last < text.length) out.push(<Fragment key="u-tend">{text.slice(last)}</Fragment>);
  return out;
}

// ── Block-level ─────────────────────────────────────────────────────────────
export function MarkdownPreview({ content, className, mentions = false }: { content: string; className?: string; mentions?: boolean }) {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  let key = 0;

  const flushList = (items: string[], ordered: boolean) => {
    const Tag = ordered ? "ol" : "ul";
    blocks.push(
      <Tag key={`k${key++}`} className={cn("my-2 space-y-1 pl-5", ordered ? "list-decimal" : "list-disc")}>
        {items.map((it, idx) => (
          <li key={idx}>{renderInline(it, `li${key}-${idx}`, mentions)}</li>
        ))}
      </Tag>,
    );
  };

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block.
    if (/^```/.test(line.trim())) {
      const buf: string[] = [];
      i += 1;
      while (i < lines.length && !/^```/.test(lines[i].trim())) buf.push(lines[i++]);
      i += 1; // closing fence
      blocks.push(
        <pre key={`k${key++}`} className="my-2 overflow-x-auto rounded-lg bg-muted/60 p-3 font-mono text-[12px] leading-[1.6]">
          <code>{buf.join("\n")}</code>
        </pre>,
      );
      continue;
    }

    // Blank line.
    if (line.trim() === "") { i += 1; continue; }

    // Headings.
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      const level = h[1].length;
      const sizes = ["text-2xl", "text-xl", "text-lg", "text-base", "text-sm", "text-sm"];
      blocks.push(
        <div key={`k${key++}`} className={cn("mt-3 mb-1 font-semibold text-foreground", sizes[level - 1])}>
          {renderInline(h[2], `h${key}`, mentions)}
        </div>,
      );
      i += 1;
      continue;
    }

    // Horizontal rule.
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) {
      blocks.push(<hr key={`k${key++}`} className="my-3 border-border" />);
      i += 1;
      continue;
    }

    // Blockquote.
    if (/^>\s?/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) buf.push(lines[i++].replace(/^>\s?/, ""));
      blocks.push(
        <blockquote key={`k${key++}`} className="my-2 border-l-2 border-border pl-3 text-muted-foreground">
          {renderInline(buf.join(" "), `q${key}`, mentions)}
        </blockquote>,
      );
      continue;
    }

    // Unordered list.
    if (/^\s*[-*+]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*[-*+]\s+/, ""));
      flushList(items, false);
      continue;
    }

    // Ordered list.
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*\d+\.\s+/, ""));
      flushList(items, true);
      continue;
    }

    // Paragraph (gather consecutive non-blank, non-structural lines).
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !/^(#{1,6})\s/.test(lines[i]) &&
      !/^```/.test(lines[i].trim()) &&
      !/^>\s?/.test(lines[i]) &&
      !/^\s*[-*+]\s+/.test(lines[i]) &&
      !/^\s*\d+\.\s+/.test(lines[i])
    ) {
      para.push(lines[i++]);
    }
    blocks.push(
      <p key={`k${key++}`} className="my-2 leading-relaxed">
        {renderInline(para.join(" "), `p${key}`, mentions)}
      </p>,
    );
  }

  return <div className={cn("text-sm text-foreground/90", className)}>{blocks}</div>;
}
