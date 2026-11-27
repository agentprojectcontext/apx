// Auto's decision on a deletion (DECISIONS.md#d-281) or another call (DECISIONS.md#d-283), short: what it decided and,
// when the line opens, who and why.
import type { AutoDecisionNote } from "@apx/protocol";
import type { T } from "../../i18n/index.ts";

/** The line: «Auto lo aprobó»; in the owner's list, «Auto te preguntó» for what waited for them. */
export const decisionVerdict = (note: Pick<AutoDecisionNote, "verdict">, t: T) =>
  t(note.verdict === "run" ? "autoDel.approved" : "autoDel.asked");

/**
 * The one line it opens to: «GPT-6-Luna · lo pediste vos», the model alone when it gave no why, «Regla fija», or no
 * answer from the model. `model` is the model as the screen names it (its catalog name).
 */
export function decisionDetail(note: Pick<AutoDecisionNote, "by" | "why" | "model">, t: T, model?: string): string {
  if (note.by === "rule") return t("autoDel.rule");
  if (!note.model) return t("autoDel.noModel");
  const name = model ?? note.model;
  return note.why ? `${name} · ${note.why}` : name;
}
