import type { ModelRef } from "@apx/protocol";

export type HelperMode = "auto" | "pick" | "off";

/** The saved helper model as the screen shows it: none (automatic), "off", or an ordered chain "a,b". */
export function readHelper(value: string | undefined): { mode: HelperMode; refs: ModelRef[] } {
  const v = value?.trim() ?? "";
  if (!v) return { mode: "auto", refs: [] };
  if (v === "off") return { mode: "off", refs: [] };
  const refs = [
    ...new Set(
      v
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  ];
  return refs.length ? { mode: "pick", refs } : { mode: "auto", refs: [] };
}

/** The chain as it is saved, first model first; an empty chain is automatic. */
export const helperValue = (refs: ModelRef[]): string | undefined => (refs.length ? refs.join(",") : undefined);
