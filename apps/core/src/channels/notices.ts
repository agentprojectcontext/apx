// How a confirmation or question is shown on a channel.
import type { Part } from "@apx/protocol";
import type { Presentation } from "../domain/channels.ts";

/**
 * Button ids on a channel (Telegram allows 64 bytes): an input's approve/deny/option, a pairing decision, or the
 * owner's 👍/👎 on a notice. Built and read only here.
 */
export const buttonId = {
  approve: (inputId: string) => `i:${inputId}:a`,
  deny: (inputId: string) => `i:${inputId}:d`,
  option: (inputId: string, n: number) => `i:${inputId}:o${n}`,
  pairing: (code: string, decision: "contact" | "deny") => `p:${code}:${decision}`,
  rate: (nudgeId: string, feedback: "up" | "down") => `f:${nudgeId}:${feedback === "up" ? "u" : "d"}`,
};

export type Button =
  | { kind: "input"; inputId: string; answer: "approve" | "deny" }
  | { kind: "option"; inputId: string; index: number }
  | { kind: "pairing"; code: string; decision: "contact" | "deny" }
  | { kind: "feedback"; nudgeId: string; feedback: "up" | "down" };

export function parseButton(data: string): Button | undefined {
  const [kind, ref, what] = data.split(":");
  if (!ref || !what) return undefined;
  if (kind === "i" && (what === "a" || what === "d"))
    return { kind: "input", inputId: ref, answer: what === "a" ? "approve" : "deny" };
  if (kind === "i" && /^o\d+$/.test(what)) return { kind: "option", inputId: ref, index: Number(what.slice(1)) };
  if (kind === "p" && (what === "contact" || what === "deny")) return { kind: "pairing", code: ref, decision: what };
  if (kind === "f" && (what === "u" || what === "d"))
    return { kind: "feedback", nudgeId: ref, feedback: what === "u" ? "up" : "down" };
  return undefined;
}

type Labels = { approve: string; deny: string };

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
  return { text: body.slice(0, 3500), ...(buttons.length ? { buttons } : {}) };
}

/** A notice the owner may rate: its 👍/👎 buttons, left out by a channel without buttons. */
export function ratedPresentation(text: string, nudgeId: string, labels: { useful: string; notUseful: string }) {
  return {
    text,
    buttons: [
      { id: buttonId.rate(nudgeId, "up"), label: labels.useful },
      { id: buttonId.rate(nudgeId, "down"), label: labels.notUseful },
    ],
    optionalButtons: true,
  } satisfies Presentation;
}
