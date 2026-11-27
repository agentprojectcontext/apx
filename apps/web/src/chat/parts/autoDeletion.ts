// Auto's decision on a deletion in the owner's words (DECISIONS.md#d-281): why it ran or asked, and who decided.
import type { AutoDeletionNote, DeletionReason } from "@apx/protocol";
import type { MessageKey, T } from "../../i18n/index.ts";

const REASON_KEY: Record<DeletionReason, MessageKey> = {
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
};

/** Why, in a few words: the judge's own, else the rules'. */
function deletionWhy(note: Pick<AutoDeletionNote, "by" | "why" | "reasons">, t: T): string {
  if (note.why) return note.why;
  if (note.by === "judge") return t("autoDel.noAnswer");
  return note.reasons.map((r) => t(REASON_KEY[r])).join(", ");
}

/** The step's line: «Auto lo borró: salida de build». */
export const deletionLine = (note: Pick<AutoDeletionNote, "verdict" | "by" | "why" | "reasons">, t: T) =>
  t(note.verdict === "run" ? "autoDel.ran" : "autoDel.asked", { why: deletionWhy(note, t) });

/** Who decided and why in full (a phone cuts the line): a fixed rule, or the helper model by its catalog name. */
export function decidedBy(
  note: Pick<AutoDeletionNote, "by" | "why" | "model" | "reasons">,
  t: T,
  name?: string,
): string {
  if (note.by === "judge" && !note.model) return t("autoDel.byNobody");
  const who =
    note.by === "rule" ? t("autoDel.byRule") : name ? t("autoDel.byModel", { model: name }) : t("autoDel.byHelper");
  return `${who}: ${deletionWhy(note, t)}`;
}
