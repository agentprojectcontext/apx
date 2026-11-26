// What a chip opens to, loaded with the chip itself (not on the first screen). See chips.ts
import type { Part } from "@apx/protocol";

type Notice = Extract<Part, { type: "notice" }>;

/** The research fields a chip lists, in the order it lists them ("location": a chip saved before places were a list). */
const RESEARCH_FIELDS = ["interests", "projects", "pages", "places", "location"] as const;
export type ResearchField = (typeof RESEARCH_FIELDS)[number];

/** What a message's chips of one kind saved, in order: a note's words, or a research field and its value. */
export function chipItems(parts: readonly Part[], code: string): Array<{ field?: ResearchField; text: string }> {
  return parts.flatMap((part) => {
    if (part.type !== "notice" || part.code !== code) return [];
    const p: Notice = part;
    if (code === "memory.saved") return p.detail ? [{ text: p.detail }] : [];
    return RESEARCH_FIELDS.flatMap((field) =>
      String(p.vars?.[field] ?? "")
        .split("\n")
        .filter(Boolean)
        .map((text) => ({ field, text })),
    );
  });
}
