// How a confirmation or question is shown on a channel.
import type { Part } from "@apx/protocol";
import type { Presentation } from "../domain/channels.ts";

/**
 * Button ids on a channel (Telegram allows 64 bytes): an input's approve/deny/option or a pairing decision. Built and
 * read only here.
 */
export const buttonId = {
  approve: (inputId: string) => `i:${inputId}:a`,
  deny: (inputId: string) => `i:${inputId}:d`,
  option: (inputId: string, n: number) => `i:${inputId}:o${n}`,
  pairing: (code: string, decision: "contact" | "deny") => `p:${code}:${decision}`,
  /** Someone kept unreviewed: answer them from now on, or keep them silenced without reports. */
  review: (personId: string, decision: "answer" | "ignore") => `r:${personId}:${decision}`,
};

export type Button =
  | { kind: "input"; inputId: string; answer: "approve" | "deny" }
  | { kind: "option"; inputId: string; index: number }
  | { kind: "pairing"; code: string; decision: "contact" | "deny" }
  | { kind: "review"; person: string; decision: "answer" | "ignore" };

export function parseButton(data: string): Button | undefined {
  const [kind, ref, what] = data.split(":");
  if (!ref || !what) return undefined;
  if (kind === "i" && (what === "a" || what === "d"))
    return { kind: "input", inputId: ref, answer: what === "a" ? "approve" : "deny" };
  if (kind === "i" && /^o\d+$/.test(what)) return { kind: "option", inputId: ref, index: Number(what.slice(1)) };
  if (kind === "p" && (what === "contact" || what === "deny")) return { kind: "pairing", code: ref, decision: what };
  if (kind === "r" && (what === "answer" || what === "ignore")) return { kind: "review", person: ref, decision: what };
  return undefined;
}

type Labels = { approve: string; deny: string; cut: (more: number) => string };

/**
 * A confirmation is one message on every channel, its buttons under the words: up to 20k chars of a call's detail
 * would be several messages on the chunking ones and cut by the others.
 */
const NOTICE_CHARS = 3500;

/** A confirmation or a question as a message with buttons only the owner can press. */
export function inputPresentation(part: Extract<Part, { type: "input" }>, labels: Labels): Presentation {
  const buttons =
    part.kind === "confirm"
      ? [
          { id: buttonId.approve(part.input_id), label: labels.approve },
          { id: buttonId.deny(part.input_id), label: labels.deny },
        ]
      : (part.options ?? [])
          .slice(0, 8)
          .map((o, i) => ({ id: buttonId.option(part.input_id, i), label: o.slice(0, 60) }));
  const body = [part.prompt, part.tool ? `${part.tool}${part.detail ? `: ${part.detail}` : ""}` : ""]
    .filter(Boolean)
    .join("\n");
  return { text: fitted(body, labels.cut), ...(buttons.length ? { buttons } : {}) };
}

/** The question comes first, so a cut takes the end of the call's detail and says how much the panel still shows. */
function fitted(body: string, cut: Labels["cut"]): string {
  if (body.length <= NOTICE_CHARS) return body;
  // Sized with the whole length: the count it finally shows has no more digits.
  const keep = NOTICE_CHARS - `… ${cut(body.length)}`.length;
  return `${body.slice(0, keep).trimEnd()}… ${cut(body.length - keep)}`;
}

/** Reactions the owner puts on a notice that count as 👍 or 👎 (no buttons: a reaction is one tap and adds no message). */
const UP = new Set(["👍", "❤", "❤️", "🔥", "👏", "🙏", "💯", "🎉", "😍", "🤩", "👌", "⚡", "🏆", "🥰", "😁"]);
const DOWN = new Set(["👎", "💩", "🤮", "😴", "🥱", "🤬", "😡", "🙄", "😐", "🤨", "😢"]);

/** What a reaction on a rated notice says: useful, not useful, nothing (taken off), or none of those. */
export function ratingOf(emoji: string): "up" | "down" | null | undefined {
  if (!emoji) return null;
  return UP.has(emoji) ? "up" : DOWN.has(emoji) ? "down" : undefined;
}
