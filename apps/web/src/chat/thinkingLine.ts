/**
 * The newest part of a reasoning summary, as one plain line. Summaries come in parts with a blank line between them,
 * each often only a bold title ("**Checking the tests**"), which shows as its words.
 */
export function thinkingLine(text: string | undefined): string | undefined {
  const part = text
    ?.trim()
    .split(/\n\s*\n/)
    .at(-1);
  const line = part
    ?.replace(/\*\*(.+?)\*\*/gs, "$1")
    .replace(/\s+/g, " ")
    .trim();
  return line || undefined;
}
