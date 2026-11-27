// Auto's decision on a deletion (DECISIONS.md#d-281) or another call (DECISIONS.md#d-283) in the owner's words: why it
// ran or asked, and who decided.
import type { AutoDecisionNote, DecisionReason } from "@apx/protocol";
import type { MessageKey, T } from "../../i18n/index.ts";

const REASON_KEY: Record<DecisionReason, MessageKey> = {
  scratch: "autoDel.reason.scratch",
  gone: "autoDel.reason.gone",
  output: "autoDel.reason.output",
  made: "autoDel.reason.made",
  container: "autoDel.reason.container",
  merged_branch: "autoDel.reason.mergedBranch",
  merged_worktree: "autoDel.reason.mergedWorktree",
  outside: "autoDel.reason.outside",
  owner: "autoDel.reason.owner",
  unmerged_branch: "autoDel.reason.unmergedBranch",
  open_worktree: "autoDel.reason.openWorktree",
  git_work: "autoDel.reason.gitWork",
  too_many: "autoDel.reason.tooMany",
  runtime: "autoDel.reason.runtime",
  no_match: "autoDel.reason.noMatch",
  outside_content: "autoDel.reason.outsideContent",
  url_data: "autoDel.reason.urlData",
  browser_steps: "autoDel.reason.browserSteps",
  connected_service: "autoDel.reason.connectedService",
  needs_ok: "autoDel.reason.needsOk",
  remote: "autoDel.reason.remote",
  script: "autoDel.reason.script",
  credential: "autoDel.reason.credential",
};

/** Why, in a few words: the judge's own, else the rules'. */
function decisionWhy(note: Pick<AutoDecisionNote, "by" | "why" | "reasons">, t: T): string {
  if (note.why) return note.why;
  if (note.by === "judge") return t("autoDel.noAnswer");
  return note.reasons.map((r) => t(REASON_KEY[r])).join(", ");
}

/** The step's line: «Auto lo borró: salida de build», «Auto lo hizo: …», «Auto te preguntó: …». */
export const decisionLine = (note: Pick<AutoDecisionNote, "kind" | "verdict" | "by" | "why" | "reasons">, t: T) =>
  t(note.verdict === "ask" ? "autoDel.asked" : note.kind === "action" ? "autoDel.did" : "autoDel.ran", {
    why: decisionWhy(note, t),
  });

/** Who decided and why in full (a phone cuts the line): a fixed rule, or the helper model by its catalog name. */
export function decidedBy(
  note: Pick<AutoDecisionNote, "by" | "why" | "model" | "reasons">,
  t: T,
  name?: string,
): string {
  if (note.by === "judge" && !note.model) return t("autoDel.byNobody");
  const who =
    note.by === "rule" ? t("autoDel.byRule") : name ? t("autoDel.byModel", { model: name }) : t("autoDel.byHelper");
  return `${who}: ${decisionWhy(note, t)}`;
}
