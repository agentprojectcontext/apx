import { doneTask, dropTask, getTask, reopenTask, setTaskStatus } from "#core/stores/tasks.js";
import { readConfig } from "#core/config/index.js";
import { DONE_COLUMN, readColumnCatalog } from "#core/tasks/columns.js";
import { missingArg, projectMeta, resolveProject } from "../helpers.js";
import { SUPERAGENT_ACTOR_ID } from "#core/constants/actors.js";

const ACTIONS = ["done", "drop", "reopen", "status"];
const ACCEPTS = { required: ["task", "action"], optional: ["project", "status", "by"] };

/**
 * Everything that can be checked without writing, done BEFORE anyone is asked
 * to confirm: a call that would fail must not put a question to the owner, and
 * the one that goes through is described with the move it makes (from → to).
 * @returns {{error: string} | {project: object, current: object, columns: string[]|null, confirm: object}}
 */
function prepare({ projects }, args = {}) {
  const { project, task, action, status } = args;
  // `task`, not `id` — and the error says so, because list_tasks and
  // create_task both hand back `id` and a model that copies it straight back
  // here has no other way to learn the difference.
  if (!task) return missingArg("complete_task", "task", ACCEPTS, args);
  if (!action) return missingArg("complete_task", "action", ACCEPTS, args);
  if (!ACTIONS.includes(action)) return { error: `unknown action "${action}" (use ${ACTIONS.join("|")})` };
  let p;
  try {
    p = resolveProject(projects, project);
  } catch (e) {
    return { error: e.message };
  }
  let columns = null;
  if (action === "status") {
    // Validated against the column catalog this install actually has, not
    // against the four built-ins. The store normalizes an unknown status to
    // "pending", so a board with a custom "qa" column used to answer
    // `action=status, status=qa` with a cheerful ok and quietly file the
    // task under pending — the one failure mode worse than an error.
    //
    // The GLOBAL catalog, not the project's displayed subset: the subset
    // lives in the daemon's project config and this is core. A column the
    // catalog knows but the board does not show still renders (columnFor
    // falls back to the first column), so the worst case is a visible card
    // in the wrong place instead of an invisible one.
    columns = readColumnCatalog(readConfig()).map((c) => c.id);
    if (!status) return { error: `status required when action is 'status'. This install has: ${columns.join(", ")}.` };
    if (String(status) === DONE_COLUMN) {
      return { error: `"${DONE_COLUMN}" is not a status — close the task with action="done".` };
    }
    if (!columns.includes(String(status))) {
      return { error: `unknown status "${status}". This install has: ${columns.join(", ")}.` };
    }
  }
  const current = getTask(p.storagePath, task);
  if (!current) return { error: `task not found: ${task}` };
  return {
    project: p,
    current,
    columns,
    confirm: {
      task: current.id,
      subject: current.title,
      action,
      ...(action === "status" ? { from: current.status, status: String(status) } : {}),
    },
  };
}

// Close or move a task. The sibling of create_task: the super-agent could add
// and list tasks but not finish one, so a "mark it done" turned into a shelled
// `apx task done`. This is the write-back half.
export default {
  name: "complete_task",
  schema: {
    type: "function",
    function: {
      name: "complete_task",
      description:
        "Change the STATE of an existing task: mark it done, drop it (archive without completing), " +
        "reopen it, or move it to another board column (action=status). Use after list_tasks to act on " +
        "what you found. `done` vs `drop` matters — drop is 'no longer relevant', done is 'finished'. " +
        "To change what the task SAYS (title, description, due date, assignee, priority) use update_task.",
      parameters: {
        type: "object",
        required: ["task", "action"],
        properties: {
          project: { type: "string", description: "Project id, name or path. Omit for the project you belong to (the default project, if you are the super-agent)." },
          task:    { type: "string", description: "Task id or a ≥3-char unique prefix (from list_tasks)." },
          action:  { type: "string", enum: ["done", "drop", "reopen", "status"], description: "done | drop | reopen | status." },
          status:  { type: "string", description: "Board column id, required when action is 'status'. Ships as pending | running | in_review | blocked, but the catalog is configurable — a wrong value comes back with the list this install has." },
          by:      { type: "string", description: "Optional: who completed/dropped it." },
        },
      },
    },
  },
  prepare,
  makeHandler: (ctx) => async (args = {}) => {
    const { requirePermission, channelMeta = null } = ctx;
    const plan = prepare(ctx, args);
    if (plan.error) return plan;
    await requirePermission("complete_task", { dangerous: true, args: plan.confirm });
    const { project: p, current, columns } = plan;
    const { action, status, by } = args;
    // Who moved the card: the calling agent from context (the model cannot sign
    // as someone else), else the super-agent's loop.
    const mover = channelMeta?.agentSlug || SUPERAGENT_ACTOR_ID;
    try {
      let result;
      if (action === "done") result = doneTask(p.storagePath, current.id, by || null);
      else if (action === "drop") result = dropTask(p.storagePath, current.id, by || null);
      else if (action === "reopen") result = reopenTask(p.storagePath, current.id);
      else result = setTaskStatus(p.storagePath, current.id, status, { statuses: columns, by: mover });
      if (!result) return { error: `task not found: ${current.id}` };
      return {
        ok: true,
        project: projectMeta(ctx.projects, p),
        task: { id: result.id, title: result.title, state: result.state, status: result.status },
      };
    } catch (e) {
      return { error: e.message };
    }
  },
};
