import { getCommitment, patchCommitment } from "#core/stores/commitments.js";
import { missingArg, projectMeta } from "../helpers.js";
import { locateRecord } from "./_locate.js";

/**
 * Everything checked before a write, run BEFORE anyone is asked to confirm: a
 * call that would fail must not put a question to the owner, and the one that
 * goes through is described with the fields it changes and their new values.
 * @returns {{error: string} | {project: object, current: object, patch: object, confirm: object}}
 */
function prepare({ projects }, args = {}) {
  const { commitment, project } = args;
  if (!commitment) {
    return missingArg(
      "update_commitment",
      "commitment",
      { required: ["commitment"], optional: ["project", "body", "counterparty", "due"] },
      args,
    );
  }

  const found = locateRecord(projects, {
    project,
    id: commitment,
    read: getCommitment,
    kind: "commitment",
    example: "c_ab12cd",
    lister: "list_commitments",
  });
  if (found.error) return { error: found.error };
  const { project: p, record: current } = found;

  const patch = {};
  if (args.body !== undefined) {
    const body = String(args.body).trim();
    // The body IS the promise. An empty one would leave a row that says
    // somebody is waiting for nothing.
    if (!body) return { error: "body cannot be empty — to retire a commitment use mark_commitment action=drop." };
    patch.body = body;
  }
  if (args.counterparty !== undefined) {
    const counterparty = String(args.counterparty).trim();
    // Same argument: the counterparty is what makes this a commitment rather
    // than a task.
    if (!counterparty) return { error: "counterparty cannot be empty — a promise with nobody waiting is a task." };
    patch.counterparty = counterparty;
  }
  if (args.due !== undefined) {
    const due = args.due === null ? null : String(args.due).trim();
    patch.due = due || null;
  }

  if (!Object.keys(patch).length) {
    return { error: "nothing to update. Pass at least one of: body, counterparty, due." };
  }

  return {
    project: p, current, patch,
    confirm: { commitment: current.id, subject: current.body, ...patch },
  };
}

// Correct a commitment that was recorded wrong.
//
// `mark_commitment` resolves one (kept | missed | drop | renegotiate) and
// `record_commitment` opens one, but neither could fix the text. A promise
// filed against the wrong person, or with the wrong thing promised, was stuck
// that way — and the only escape was to drop it and record a new one, which
// loses the date it was promised on.
//
// `due` here means "this was written down wrong". A NEW date agreed with the
// other person is mark_commitment action=renegotiate, which keeps the old date
// in the history — moving a deadline twice is a fact about the relationship,
// and it is only visible if it is recorded as a move.
export default {
  name: "update_commitment",
  schema: {
    type: "function",
    function: {
      name: "update_commitment",
      description:
        "Correct an existing commitment: what was promised (body), to whom (counterparty), or a " +
        "mis-recorded date. Use it to FIX a mistake in what was written down. A new date actually " +
        "agreed with the person is mark_commitment action=renegotiate instead — that one keeps the " +
        "history of the move. Omit `project` to find the commitment wherever it is.",
      parameters: {
        type: "object",
        required: ["commitment"],
        properties: {
          commitment:   { type: "string", description: "Commitment id or a ≥3-char unique prefix (from list_commitments)." },
          project:      { type: "string", description: "Project id, name or path. Omit to find it wherever it is." },
          body:         { type: "string", description: "What was promised, in one line." },
          counterparty: { type: "string", description: "Who is waiting for it." },
          due:          { type: "string", description: "ISO date — only to FIX a mis-recorded one. \"\" clears it." },
        },
      },
    },
  },
  prepare,
  makeHandler: (ctx) => async (args = {}) => {
    const plan = prepare(ctx, args);
    if (plan.error) return plan;
    await ctx.requirePermission("update_commitment", { dangerous: true, args: plan.confirm });
    const { project: p, current, patch } = plan;
    const projects = ctx.projects;

    try {
      const updated = patchCommitment(p.storagePath, current.id, patch);
      if (!updated) return { error: `commitment not found: ${current.id}` };
      return {
        ok: true,
        project: projectMeta(projects, p),
        changed: Object.keys(patch),
        commitment: {
          id: updated.id,
          counterparty: updated.counterparty,
          body: updated.body,
          due: updated.due,
          state: updated.state,
        },
        ...(patch.due !== undefined
          ? { note: "Recorded as a correction, not a renegotiation — the previous date is not in the history." }
          : {}),
      };
    } catch (e) {
      return { error: e.message };
    }
  },
};
