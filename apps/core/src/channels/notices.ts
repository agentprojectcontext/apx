// Quiet hours and how a confirmation or question is shown on a channel.
import type { NoticePrefs, Part } from "@apx/protocol";
import type { Presentation } from "../domain/channels.ts";

const minutes = (hhmm: string) => {
  const [h = 0, m = 0] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

/** Whether `now` (local time) falls in the quiet window; a window may cross midnight (23:00 → 08:00). */
export function inQuietHours(prefs: NoticePrefs, now = new Date()): boolean {
  if (!prefs.quiet_from || !prefs.quiet_to) return false;
  const at = now.getHours() * 60 + now.getMinutes();
  const from = minutes(prefs.quiet_from);
  const to = minutes(prefs.quiet_to);
  return from <= to ? at >= from && at < to : at >= from || at < to;
}

/**
 * Button ids on a channel (Telegram allows 64 bytes): an input's approve/deny/option, or a pairing decision. Built
 * and read only here.
 */
export const buttonId = {
  approve: (inputId: string) => `i:${inputId}:a`,
  deny: (inputId: string) => `i:${inputId}:d`,
  option: (inputId: string, n: number) => `i:${inputId}:o${n}`,
  pairing: (code: string, decision: "contact" | "deny") => `p:${code}:${decision}`,
};

export type Button =
  | { kind: "input"; inputId: string; answer: "approve" | "deny" }
  | { kind: "option"; inputId: string; index: number }
  | { kind: "pairing"; code: string; decision: "contact" | "deny" };

export function parseButton(data: string): Button | undefined {
  const [kind, ref, what] = data.split(":");
  if (!ref || !what) return undefined;
  if (kind === "i" && (what === "a" || what === "d"))
    return { kind: "input", inputId: ref, answer: what === "a" ? "approve" : "deny" };
  if (kind === "i" && /^o\d+$/.test(what)) return { kind: "option", inputId: ref, index: Number(what.slice(1)) };
  if (kind === "p" && (what === "contact" || what === "deny")) return { kind: "pairing", code: ref, decision: what };
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
