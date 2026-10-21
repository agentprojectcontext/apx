// How a confirmation or question is shown on a channel.
import type { Part } from "@apx/protocol";
import type { Presentation } from "../domain/channels.ts";
import type { ChannelConfig } from "./types.ts";

/**
 * Button ids on a channel (Telegram allows 64 bytes): an input's approve/deny/option or a pairing decision. Built and
 * read only here.
 */
export const buttonId = {
  approve: (inputId: string) => `i:${inputId}:a`,
  deny: (inputId: string) => `i:${inputId}:d`,
  option: (inputId: string, n: number) => `i:${inputId}:o${n}`,
  /** A multi-choice question: tick or untick an option, then send what is ticked. */
  toggle: (inputId: string, n: number) => `i:${inputId}:t${n}`,
  confirm: (inputId: string) => `i:${inputId}:c`,
  /** A question the owner leaves unanswered: the agent goes on without it. */
  skip: (inputId: string) => `i:${inputId}:s`,
  pairing: (code: string, decision: "contact" | "deny") => `p:${code}:${decision}`,
  /** Someone kept unreviewed: answer them from now on, or keep them silenced without reports. */
  review: (personId: string, decision: "answer" | "ignore") => `r:${personId}:${decision}`,
  /** A delegated session a limit stopped while it looked stuck: one more turn, as Continue in the app. */
  goOn: (session: string) => `d:${session}:go`,
  /** A reply drafted for a supervised contact: send it, answer them yourself, or drop it. */
  suggestion: (id: string, decision: SuggestionDecision) => `s:${id}:${decision}`,
  /** One of a release news entry's actions (news/entries.ts): what it asks goes to the agent as the owner's words. */
  news: (entry: string, n: number) => `n:${entry}:${n}`,
};

export type SuggestionDecision = "send" | "write" | "ignore";

export type Button =
  | { kind: "input"; inputId: string; answer: "approve" | "deny" }
  | { kind: "option"; inputId: string; index: number }
  | { kind: "toggle"; inputId: string; index: number }
  | { kind: "confirm"; inputId: string }
  | { kind: "skip"; inputId: string }
  | { kind: "pairing"; code: string; decision: "contact" | "deny" }
  | { kind: "review"; person: string; decision: "answer" | "ignore" }
  | { kind: "suggestion"; id: string; decision: SuggestionDecision }
  | { kind: "continue"; session: string }
  | { kind: "news"; entry: string; index: number };

export function parseButton(data: string): Button | undefined {
  const [kind, ref, what] = data.split(":");
  if (!ref || !what) return undefined;
  if (kind === "i" && (what === "a" || what === "d"))
    return { kind: "input", inputId: ref, answer: what === "a" ? "approve" : "deny" };
  if (kind === "i" && /^o\d+$/.test(what)) return { kind: "option", inputId: ref, index: Number(what.slice(1)) };
  if (kind === "i" && /^t\d+$/.test(what)) return { kind: "toggle", inputId: ref, index: Number(what.slice(1)) };
  if (kind === "i" && (what === "c" || what === "s")) return { kind: what === "c" ? "confirm" : "skip", inputId: ref };
  if (kind === "p" && (what === "contact" || what === "deny")) return { kind: "pairing", code: ref, decision: what };
  if (kind === "r" && (what === "answer" || what === "ignore")) return { kind: "review", person: ref, decision: what };
  if (kind === "d" && what === "go") return { kind: "continue", session: ref };
  if (kind === "s" && (what === "send" || what === "write" || what === "ignore"))
    return { kind: "suggestion", id: ref, decision: what };
  if (kind === "n" && /^\d+$/.test(what)) return { kind: "news", entry: ref, index: Number(what) };
  return undefined;
}

type Labels = { approve: string; deny: string; send: string; skip: string; cut: (more: number) => string };

/** What a channel shows of an input (a chat part or a stored record, both carry these). */
export type InputShown = Pick<
  Extract<Part, { type: "input" }>,
  "input_id" | "kind" | "prompt" | "tool" | "detail" | "options" | "multi"
>;

/**
 * A confirmation is one message on every channel, its buttons under the words: up to 20k chars of a call's detail
 * would be several messages on the chunking ones and cut by the others.
 */
const NOTICE_CHARS = 3500;

/**
 * A confirmation or a question as a message with buttons only the owner can press. A multi-choice question shows
 * each option ticked or not (`picked`), then Send; every question can be skipped.
 */
export function inputPresentation(
  part: InputShown,
  labels: Labels,
  picked: ReadonlySet<number> = new Set(),
): Presentation {
  const id = part.input_id;
  const options = (part.options ?? []).slice(0, 8);
  const buttons =
    part.kind === "confirm"
      ? [
          { id: buttonId.approve(id), label: labels.approve },
          { id: buttonId.deny(id), label: labels.deny },
        ]
      : [
          ...options.map((o, i) =>
            part.multi
              ? { id: buttonId.toggle(id, i), label: `${picked.has(i) ? "☑" : "☐"} ${o.slice(0, 58)}` }
              : { id: buttonId.option(id, i), label: o.slice(0, 60) },
          ),
          ...(part.multi && options.length ? [{ id: buttonId.confirm(id), label: labels.send }] : []),
          { id: buttonId.skip(id), label: labels.skip },
        ];
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

/** A name with its phone number when the channel has one (a stranger picks their own name; the number is theirs). */
export function shown(cfg: Pick<ChannelConfig, "type">, name: string, externalId: string): string {
  const phone = cfg.type === "whatsapp" ? /^(\d{6,})@s\.whatsapp\.net$/.exec(externalId)?.[1] : undefined;
  return phone ? `${name} (+${phone})` : name;
}
