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

type Saved = { aux_model?: string | undefined; aux_chain?: string | undefined };

/** The models the owner chose: the live chain while Chosen is on, else the list kept for when it is back on. */
export function chosenRefs(s: Saved): ModelRef[] {
  const live = readHelper(s.aux_model);
  return live.mode === "pick" ? live.refs : readHelper(s.aux_chain).refs;
}

/**
 * What a mode saves, with the chosen list always kept apart: Automatic or Off leave it there, and Chosen with an empty
 * list is Automatic until a model is picked.
 */
export function helperPatch(mode: HelperMode, chosen: ModelRef[]): { aux_model?: string; aux_chain: string } {
  const chain = helperValue(chosen) ?? "";
  if (mode === "off") return { aux_model: "off", aux_chain: chain };
  if (mode === "pick" && chain) return { aux_model: chain, aux_chain: chain };
  return { aux_chain: chain };
}
