// Whether a delegated run a limit cut short was getting somewhere, as a supervisor would judge it: APX goes on with it
// on its own while it is, and stops for the owner only when a part looks stuck (DECISIONS.md#d-116).
import type { Step } from "../domain/runs.ts";

/** Parts APX starts on its own in a row after the first one: a ceiling far past real work, not the usual stop. */
export const MAX_AUTO_PARTS = 8;

const signature = (s: Step) => `${s.tool}:${JSON.stringify(s.args)}`;

/**
 * Why the part in `steps` made no progress after the part before it (`before`), or undefined when it did: it got
 * something done with an effect, mostly worked, and did not go round the same calls or redo the last part's.
 */
export function stalled(steps: readonly Step[], before: readonly Step[] = []): string | undefined {
  const done = steps.filter((s) => s.state === "ok" || s.state === "error");
  const ok = done.filter((s) => s.state === "ok");
  if (!ok.length) return "none of its calls worked";
  if (ok.length < done.length / 5) return "most of its calls failed";
  const acted = new Set(ok.filter((s) => s.effect !== "none").map(signature));
  if (!acted.size) return "it only looked things up and changed nothing";
  if (new Set(done.map(signature)).size < done.length / 2) return "it kept repeating the same calls";
  const earlier = new Set(before.map(signature));
  const redone = [...acted].filter((x) => earlier.has(x)).length;
  if (earlier.size && redone >= acted.size * 0.8) return "it redid what its last part had done";
  return undefined;
}
