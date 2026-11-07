// An agent's words cut at its fenced blocks: each block (code, a page, a diagram, an email) is a card between the
// bubbles of text around it. Fences are read the way MarkdownView reads them.

export type ReplySegment =
  | { kind: "text"; text: string }
  /** `lang`: the fence's word, lowercased ("" when none); `open`: its closing fence has not arrived yet. */
  | { kind: "block"; lang: string; code: string; open: boolean };

const fenceLang = (line: string) => /^```\s*([\w+-]+)/.exec(line.trimStart())?.[1]?.toLowerCase();

export function replySegments(text: string): ReplySegment[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const out: ReplySegment[] = [];
  let words: string[] = [];
  const flush = () => {
    const kept = words.join("\n");
    if (kept.trim()) out.push({ kind: "text", text: kept });
    words = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (!line.trimStart().startsWith("```")) {
      words.push(line);
      continue;
    }
    let end = i + 1;
    while (end < lines.length && !(lines[end] ?? "").trimStart().startsWith("```")) end++;
    flush();
    out.push({
      kind: "block",
      lang: fenceLang(line) ?? "",
      code: lines.slice(i + 1, end).join("\n"),
      open: end >= lines.length,
    });
    i = end;
  }
  flush();
  return out;
}
