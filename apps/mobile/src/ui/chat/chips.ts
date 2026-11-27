import { type Key, t } from "../../i18n/index.ts";
import type { Message } from "../../protocol.ts";

type Part = Message["parts"][number];
const isChip = (part: Part) =>
  part.type === "notice" && (part.code === "memory.saved" || part.code === "research.updated");
const fields: Record<string, Key> = {
  interests: "researchInterest",
  projects: "researchProject",
  pages: "researchPage",
  places: "researchPlace",
  location: "researchPlace",
};

/** Keep the first chip in place; its later notes and successful matching calls fold into it. */
export function chipFold(parts: readonly Part[]) {
  const first = new Set<string>();
  const later = new Set<Part>();
  const calls = new Set<string>();
  for (const part of parts) {
    if (part.type !== "notice" || !isChip(part)) continue;
    if (
      typeof part.vars?.call === "string" &&
      parts.some((p) => p.type === "tool" && p.call_id === part.vars?.call && p.status === "ok")
    )
      calls.add(part.vars.call);
    if (first.has(part.code)) later.add(part);
    else first.add(part.code);
  }
  return { later, calls };
}

/** Every saved item, in order and without truncation, including older receipts with only a detail. */
export function chipDetails(parts: readonly Part[], code: string): string[] | undefined {
  if (code !== "memory.saved" && code !== "research.updated") return undefined;
  return parts.flatMap((part) => {
    if (part.type !== "notice" || part.code !== code) return [];
    if (code === "memory.saved") return part.detail ? [part.detail] : [];
    const items = Object.entries(fields).flatMap(([field, key]) =>
      String(part.vars?.[field] ?? "")
        .split("\n")
        .filter(Boolean)
        .map((value) => t(key, { value })),
    );
    return [...items, ...(part.detail ? [part.detail] : [])];
  });
}
