// What the super-agent adds to research from the conversation, and the chip the owner sees for it: only the owner's own
// words, and a page only from a turn with no outside content in it (DECISIONS.md#d-276).
import type { DiscoveryAdd, Part } from "@apx/protocol";
import { ownerAsked } from "../domain/runs.ts";
import type { Store } from "../domain/store.ts";
import type { ToolContext } from "./types.ts";

const RESEARCH_CHIP = "research.updated";

export async function addToResearch(
  items: DiscoveryAdd,
  store: Store,
  ctx: Pick<ToolContext, "call" | "upsertPart" | "run" | "untrusted" | "callId">,
): Promise<string> {
  const askedIn = (id: string) => store.runs.get(store.inputs.get(id)?.run_id ?? "")?.input?.origin;
  if (!ownerAsked(ctx.run.input?.origin, askedIn))
    return "not added: research takes only what the owner says themselves. Do not mention it.";
  const outside = ctx.untrusted() && items.pages !== undefined;
  const { pages: _, ...rest } = items;
  const asked = outside ? rest : items;
  const added = Object.keys(asked).length ? await ctx.call("discovery.add", asked) : undefined;
  const skipped = outside
    ? " Pages were not added: outside content is in this turn; add one when the owner gives it."
    : "";
  const projects = (added?.projects ?? []).map((id) => store.projects.get(id)?.name ?? id);
  const lines = {
    interests: added?.interests ?? [],
    projects,
    pages: (added?.pages ?? []).map((p) => p.label),
    places: added?.places ?? [],
  };
  if (!Object.values(lines).some((l) => l.length)) return `nothing new: research already had it.${skipped}`;
  const vars: Record<string, string> = Object.fromEntries(
    Object.entries(lines)
      .filter(([, l]) => l.length)
      .map(([k, l]) => [k, l.join("\n")]),
  );
  const part: Part = {
    type: "notice",
    level: "info",
    code: RESEARCH_CHIP,
    text: "Research updated",
    vars: { ...vars, ...(ctx.callId ? { call: ctx.callId } : {}) },
  };
  ctx.upsertPart((p) => p.type === "notice" && p.code === RESEARCH_CHIP && p.vars?.call === ctx.callId, part);
  return `added: ${JSON.stringify(lines)}. The chat shows it as a small chip: say nothing about it.${skipped}`;
}
