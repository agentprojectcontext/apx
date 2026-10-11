import {
  getCommitment, keepCommitment, missCommitment, dropCommitment, renegotiateCommitment,
} from "#core/stores/commitments.js";
import { missingArg, projectMeta, resolveProject } from "../helpers.js";

const ACTIONS = ["kept", "missed", "drop", "renegotiate"];
const ACCEPTS = { required: ["commitment", "action"], optional: ["project", "due", "note"] };

/**
 * Everything checked before a write, run BEFORE anyone is asked to confirm: a
 * call that would fail must not put a question to the owner, and the one that
 * goes through is described with what it resolves.
 * @returns {{error: string} | {project: object, current: object, confirm: object}}
 */
function prepare({ projects }, args = {}) {
  const { project, commitment, action, due } = args;
  // Same trap as complete_task: list_commitments returns `id`, this takes
  // `commitment`. Say which, rather than only that one is missing.
  if (!commitment) return missingArg("mark_commitment", "commitment", ACCEPTS, args);
  if (!action) return missingArg("mark_commitment", "action", ACCEPTS, args);
  if (!ACTIONS.includes(action)) return { error: `unknown action "${action}" (use ${ACTIONS.join("|")})` };
  if (action === "renegotiate" && !due) return { error: "due required when action is 'renegotiate'" };
  let p;
  try {
    p = resolveProject(projects, project);
  } catch (e) {
    return { error: e.message };
  }
  const current = getCommitment(p.storagePath, commitment);
  if (!current) return { error: `commitment not found: ${commitment}` };
  return {
    project: p,
    current,
    confirm: {
      commitment: current.id,
      subject: current.body,
      action,
      ...(action === "renegotiate" ? { from: current.due || null, due } : {}),
    },
  };
}

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
          project:    { type: "string", description: "Project id, name or path. Omit for the project you belong to (the default project, if you are the super-agent)." },
          commitment: { type: "string", description: "Commitment id or a ≥3-char unique prefix (from list_commitments)." },
          action:     { type: "string", enum: ["kept", "missed", "drop", "renegotiate"], description: "kept | missed | drop | renegotiate." },
          due:        { type: "string", description: "New due date (ISO). REQUIRED when action is 'renegotiate'." },
          note:       { type: "string", description: "Optional note recorded with the change." },
        },
      },
    },
  },
  prepare,
  makeHandler: (ctx) => async (args = {}) => {
    const plan = prepare(ctx, args);
    if (plan.error) return plan;
    await ctx.requirePermission("mark_commitment", { dangerous: true, args: plan.confirm });
    const { project: p, current } = plan;
    const { action, due, note } = args;
    try {
      let result;
      if (action === "kept") result = keepCommitment(p.storagePath, current.id, note || null);
      else if (action === "missed") result = missCommitment(p.storagePath, current.id, note || null);
      else if (action === "drop") result = dropCommitment(p.storagePath, current.id, note || null);
      else result = renegotiateCommitment(p.storagePath, current.id, due, note || null);
      if (!result) return { error: `commitment not found: ${current.id}` };
      return { ok: true, action, project: projectMeta(ctx.projects, p), commitment: result };
    } catch (e) {
      return { error: e.message };
    }
  },
};
