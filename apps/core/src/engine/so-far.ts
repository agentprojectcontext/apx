/**
 * What a delegate reported so far, as plain text for a notice: no markdown, one line, cut at a sentence end or else at
 * a word (with "…"), never mid-word.
 */
export function soFar(text: string, max = 200): string {
  const lines = text
    .replace(/```[\s\S]*?(```|$)/g, "\n")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .split("\n")
    .map((line) =>
      line
        .replace(/^\s*(#{1,6}|>|[-*+]|\d+[.)])\s+/, "")
        .replace(/\*\*|__|~~|`/g, "")
        .replace(/(^|[\s(])[*_]([^*_\n]+)[*_](?=[\s).,;:!?]|$)/g, "$1$2")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter((line) => line && !/^[-*_=|:\s]+$/.test(line));
  const plain = lines.reduce((all, line) => (all ? `${all}${/[.!?:;…]$/.test(all) ? " " : ". "}${line}` : line), "");
  if (plain.length <= max) return plain;
  const cut = plain.slice(0, max + 1);
  const sentence = Math.max(...[". ", "! ", "? "].map((end) => cut.lastIndexOf(end)));
  if (sentence >= max / 2) return cut.slice(0, sentence + 1);
  const word = cut.lastIndexOf(" ");
  return `${(word > 0 ? cut.slice(0, word) : cut.slice(0, max)).replace(/[\s,;:.-]+$/, "")}…`;
}
