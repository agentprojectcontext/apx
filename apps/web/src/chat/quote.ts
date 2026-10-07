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
  const words = text.trim();
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
