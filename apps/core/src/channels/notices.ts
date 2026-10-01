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

type Labels = { approve: string; deny: string };

/** A confirmation or a question as a message with buttons only the owner can press. */
export function inputPresentation(part: Extract<Part, { type: "input" }>, labels: Labels): Presentation {
  const buttons =
    part.kind === "confirm"
      ? [
          { id: `i:${part.input_id}:a`, label: labels.approve },
          { id: `i:${part.input_id}:d`, label: labels.deny },
        ]
      : (part.options ?? []).slice(0, 8).map((o, i) => ({ id: `i:${part.input_id}:o${i}`, label: o.slice(0, 60) }));
  const body = [part.prompt, part.tool ? `${part.tool}${part.detail ? `: ${part.detail}` : ""}` : ""]
    .filter(Boolean)
    .join("\n");
  return { text: body.slice(0, 3500), ...(buttons.length ? { buttons } : {}) };
}
