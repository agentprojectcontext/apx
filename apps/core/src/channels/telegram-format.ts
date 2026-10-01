// Agents write Markdown; Telegram reads a small HTML subset. This converts the common parts (bold, italic, code,
// links, headings, bullets) and escapes everything else, so a reply never fails for a stray "<".

const escapeHtml = (s: string) => s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

function inline(s: string): string {
  // Inline code first: what is inside it is never formatted.
  return s
    .split(/(`[^`\n]+`)/g)
    .map((part) => {
      if (part.startsWith("`") && part.endsWith("`") && part.length > 1)
        return `<code>${escapeHtml(part.slice(1, -1))}</code>`;
      return escapeHtml(part)
        .replace(
          /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g,
          (_m, t: string, u: string) => `<a href="${u.replaceAll('"', "%22")}">${t}</a>`,
        )
        .replace(/\*\*([^*\n]+)\*\*/g, "<b>$1</b>")
        .replace(/__([^_\n]+)__/g, "<b>$1</b>")
        .replace(/(^|[\s(])\*([^*\n]+)\*(?=$|[\s.,;:!?)])/g, "$1<i>$2</i>")
        .replace(/~~([^~\n]+)~~/g, "<s>$1</s>");
    })
    .join("");
}

function line(l: string): string {
  const heading = /^#{1,6}\s+(.*)$/.exec(l);
  if (heading) return `<b>${inline(heading[1] ?? "")}</b>`;
  const bullet = /^(\s*)[-*+]\s+(.*)$/.exec(l);
  if (bullet) return `${bullet[1] ?? ""}• ${inline(bullet[2] ?? "")}`;
  return inline(l);
}

/** Markdown → Telegram HTML. */
export function toTelegramHtml(md: string): string {
  return md
    .split(/(```[\s\S]*?```)/g)
    .map((block) => {
      if (block.startsWith("```") && block.endsWith("```") && block.length >= 6) {
        const body = block.slice(3, -3).replace(/^[\w+-]*\n/, "");
        return `<pre>${escapeHtml(body.replace(/\n$/, ""))}</pre>`;
      }
      return block.split("\n").map(line).join("\n");
    })
    .join("");
}

/**
 * Splits a long Markdown text at paragraph, then line, then hard boundaries, under Telegram's limit. A code block cut
 * in two is closed at the end of one part and reopened at the start of the next.
 */
export function chunks(text: string, max = 3800): string[] {
  const out: string[] = [];
  let rest = text.trim();
  while (rest.length > max) {
    const cut = [rest.lastIndexOf("\n\n", max), rest.lastIndexOf("\n", max), rest.lastIndexOf(" ", max)].find(
      (i) => i > max * 0.5,
    );
    const at = cut ?? max;
    let part = rest.slice(0, at).trim();
    rest = rest.slice(at).trim();
    if ((part.match(FENCE_RE)?.length ?? 0) % 2 === 1) {
      part = `${part}\n${FENCE}`;
      rest = `${FENCE}\n${rest}`;
    }
    out.push(part);
  }
  if (rest) out.push(rest);
  return out;
}

const FENCE = "```";
const FENCE_RE = /```/g;
