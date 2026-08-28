import { doneTask, dropTask, reopenTask, setTaskStatus } from "#core/stores/tasks.js";
import { missingArg, projectMeta, resolveProject } from "../helpers.js";

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
        "Change the state of an existing task: mark it done, drop it (archive without completing), reopen it, or set its workflow status (pending|running|in_review|blocked). Use after list_tasks to act on what you found. `done` vs `drop` matters — drop is 'no longer relevant', done is 'finished'.",
      parameters: {
        type: "object",
        required: ["task", "action"],
        properties: {
          project: { type: "string", description: "Project id, name or path. Omit or 'default' for ~/.apx/projects/default." },
          task:    { type: "string", description: "Task id or a ≥3-char unique prefix (from list_tasks)." },
          action:  { type: "string", enum: ["done", "drop", "reopen", "status"], description: "done | drop | reopen | status." },
          status:  { type: "string", enum: ["pending", "running", "in_review", "blocked"], description: "Required when action is 'status'." },
          by:      { type: "string", description: "Optional: who completed/dropped it." },
        },
      },
    },
  },
  makeHandler: ({ projects, requirePermission }) => async (args = {}) => {
    const { project, task, action, status, by } = args;
    await requirePermission("complete_task", { dangerous: true, args: { task, action } });
    // `task`, not `id` — and the error says so, because list_tasks and
    // create_task both hand back `id` and a model that copies it straight back
    // here has no other way to learn the difference.
    if (!task) return missingArg("complete_task", "task", { required: ["task", "action"], optional: ["project", "status", "by"] }, args);
    let p;
    try {
      p = resolveProject(projects, project || "default");
    } catch (e) {
      return { error: e.message };
    }
    try {
      let result;
      if (action === "done") result = doneTask(p.storagePath, task, by || null);
      else if (action === "drop") result = dropTask(p.storagePath, task, by || null);
      else if (action === "reopen") result = reopenTask(p.storagePath, task);
      else if (action === "status") {
        if (!status) return { error: "status required when action is 'status'" };
        result = setTaskStatus(p.storagePath, task, status);
      } else return { error: `unknown action "${action}" (use done|drop|reopen|status)` };
      if (!result) return { error: `task not found: ${task}` };
      return {
        ok: true,
        project: projectMeta(projects, p),
        task: { id: result.id, title: result.title, state: result.state, status: result.status },
      };
    } catch (e) {
      return { error: e.message };
    }
  },
};
