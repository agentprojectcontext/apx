// The owner's messages their agent has not taken yet (Message.waiting), as the panel's data/waiting.ts reads them.
import type { Message } from "../protocol";

/** The chat's messages in line for the agent's next turn, in the order they will run. */
export const inLine = (messages: readonly Message[]): Message[] =>
  messages.filter((m) => m.waiting?.until === "turn").sort((a, b) => a.seq - b.seq);

/** What the transcript shows: the line sits below it, in the order it will run, not where it was written. */
export const outOfLine = (messages: readonly Message[]): Message[] =>
  messages.some((m) => m.waiting?.until === "turn")
    ? messages.filter((m) => m.waiting?.until !== "turn")
    : [...messages];

/** The line's runs with one message moved a place up (-1) or down (+1); undefined when it cannot move. */
export function movedRuns(line: readonly Message[], id: string, by: -1 | 1): string[] | undefined {
  const at = line.findIndex((m) => m.id === id);
  const to = at + by;
  if (at < 0 || to < 0 || to >= line.length) return undefined;
  const order = [...line];
  [order[at], order[to]] = [order[to] as Message, order[at] as Message];
  return order.flatMap((m) => (m.waiting?.run ? [m.waiting.run] : []));
}

/** The words of an owner's message, as its edit box starts. */
export const wordsOf = (message: Message): string =>
  message.parts.flatMap((p) => (p.type === "text" ? [p.text] : [])).join("\n\n");
