import {
  keepCommitment, missCommitment, dropCommitment, renegotiateCommitment,
} from "#core/stores/commitments.js";
import { missingArg, projectMeta, resolveProject } from "../helpers.js";

// Close out a commitment. The sibling of record_commitment: a promise you can
// record but never resolve is a promise that silently rots. kept/missed carry
// the relationship; drop retracts a mis-filed one; renegotiate needs a new date.
export default {
  name: "mark_commitment",
  schema: {
    type: "function",
    function: {
      name: "mark_commitment",
      description:
        "Resolve a commitment recorded with record_commitment: kept (you delivered), missed (the date passed and it didn't happen), drop (it was filed by mistake — not the same as missed), or renegotiate (a new date agreed with them, which requires `due`). Use after list_commitments.",
      parameters: {
        type: "object",
        required: ["commitment", "action"],
        properties: {
          project:    { type: "string", description: "Project id, name or path. Omit or 'default' for ~/.apx/projects/default." },
          commitment: { type: "string", description: "Commitment id or a ≥3-char unique prefix (from list_commitments)." },
          action:     { type: "string", enum: ["kept", "missed", "drop", "renegotiate"], description: "kept | missed | drop | renegotiate." },
          due:        { type: "string", description: "New due date (ISO). REQUIRED when action is 'renegotiate'." },
          note:       { type: "string", description: "Optional note recorded with the change." },
        },
      },
    },
  },
  makeHandler: ({ projects, requirePermission }) => async (args = {}) => {
    const { project, commitment, action, due, note } = args;
    await requirePermission("mark_commitment", { dangerous: true, args: { commitment, action } });
    // Same trap as complete_task: list_commitments returns `id`, this takes
    // `commitment`. Say which, rather than only that one is missing.
    if (!commitment) return missingArg("mark_commitment", "commitment", { required: ["commitment", "action"], optional: ["project", "due", "note"] }, args);
    let p;
    try {
      p = resolveProject(projects, project || "default");
    } catch (e) {
      return { error: e.message };
    }
    try {
      let result;
      if (action === "kept") result = keepCommitment(p.storagePath, commitment, note || null);
      else if (action === "missed") result = missCommitment(p.storagePath, commitment, note || null);
      else if (action === "drop") result = dropCommitment(p.storagePath, commitment, note || null);
      else if (action === "renegotiate") {
        if (!due) return { error: "due required when action is 'renegotiate'" };
        result = renegotiateCommitment(p.storagePath, commitment, due, note || null);
      } else return { error: `unknown action "${action}" (use kept|missed|drop|renegotiate)` };
      if (!result) return { error: `commitment not found: ${commitment}` };
      return { ok: true, action, project: projectMeta(projects, p), commitment: result };
    } catch (e) {
      return { error: e.message };
    }
  },
};
