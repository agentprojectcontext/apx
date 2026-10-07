// Quoting a bubble into a reply: the quote is plain "> " lines at the top of the text, so whoever reads the reply
// (the owner, an agent) sees what it answers without any field of its own.
import type { Message } from "@apx/protocol";
import { createContext } from "react";

/** Where a bubble's quote goes; given only where the chat takes comments that can quote (a task's conversation). */
export const QuoteContext = createContext<((message: Message, text: string, reply: boolean) => void) | undefined>(
  undefined,
);

/** A quote of `text` by `author`, cut to `max` characters: "> Roby: first line\n> second line". */
export function quoteBlock(author: string, text: string, max = 280): string {
  const words = withoutAuthor(author, text.trim());
  const body = words.length > max ? `${words.slice(0, max).trimEnd()}…` : words;
  return body
    .split("\n")
    .map((line, i) => `> ${i === 0 && author ? `${author}: ` : ""}${line}`.trimEnd())
    .join("\n");
}

/** A text's leading quote ("> " lines) apart from what it says after. */
export function splitQuote(text: string): { quote: string; rest: string } {
  const lines = text.split("\n");
  let n = 0;
  while (n < lines.length && /^>\s?/.test(lines[n] ?? "")) n++;
  if (!n) return { quote: "", rest: text };
  return {
    quote: lines
      .slice(0, n)
      .map((l) => l.replace(/^>\s?/, ""))
      .join("\n"),
    rest: lines.slice(n).join("\n").trim(),
  };
}

/** Agents often start with their own name ("Roby: …"); a quote that names them already does not repeat it. */
function withoutAuthor(author: string, text: string): string {
  return author && text.startsWith(`${author}:`) ? text.slice(author.length + 1).trimStart() : text;
}

/** A quote's author (the "Name: " its first line starts with) and its words. */
export function quoteParts(quote: string): { author: string; text: string } {
  const match = /^([^:\n]{1,40}):\s/.exec(quote);
  if (!match?.[1]) return { author: "", text: quote };
  const author = match[1].trim();
  return { author, text: withoutAuthor(author, quote.slice(match[0].length).trimStart()) };
}

const flat = (s: string) => s.replace(/\s+/g, " ").trim();

/**
 * The message a quote was taken from: the latest one before `index` whose words hold the quote's (a long quote was
 * cut with "…", so only its start is compared).
 */
export function quotedIndex(texts: readonly string[], index: number, quote: string): number {
  const words = flat(quoteParts(quote).text.replace(/…$/, "")).slice(0, 120);
  if (!words) return -1;
  for (let i = Math.min(index, texts.length) - 1; i >= 0; i--) if (flat(texts[i] ?? "").includes(words)) return i;
  return -1;
}
