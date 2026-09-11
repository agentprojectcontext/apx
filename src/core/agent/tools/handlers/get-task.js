import { listTasks } from "#core/stores/tasks.js";
import { missingArg, projectMeta } from "../helpers.js";
import { locateTask, subtaskRows } from "./_tasks.js";

// Read ONE task in full. The half of the pair `list_tasks` cannot be.
//
// List rows are deliberately compact — twenty tasks with their threads is a
// payload nobody reads — so `description`, `body`, the comments and the place
// are dropped from every row. Which left the agent with no way to read what a
// task actually says: it knew the title and had to shell out to `apx task show`
// (or worse, parse the JSONL) for the one field that told it what to do.
export default {
  name: "get_task",
  schema: {
    type: "function",
    function: {
      name: "get_task",
      description:
        "Read one task in full: description, the agent prompt (body), tags, due date, assignee, " +
        "priority, place, its comment thread and its subtasks. Use it after list_tasks whenever you " +
        "need more than the title — list rows carry no description and no comments. Omit `project` " +
        "and the task is looked up across every project.",
      parameters: {
        type: "object",
        required: ["task"],
        properties: {
          task:     { type: "string", description: "Task id or a ≥3-char unique prefix (from list_tasks)." },
          project:  { type: "string", description: "Project id, name or path. Omit to find the task wherever it is." },
          comments: { type: "boolean", description: "Include the comment thread. Default true." },
        },
      },
    },
  },
  makeHandler: ({ projects }) => async (args = {}) => {
    const { task, project, comments = true } = args;
    if (!task) {
      return missingArg("get_task", "task", { required: ["task"], optional: ["project", "comments"] }, args);
    }

    const found = locateTask(projects, { project, task });
    if (found.error) return { error: found.error };
    const { project: p, task: t } = found;

    let subtasks = [];
    try {
      subtasks = subtaskRows(listTasks(p.storagePath, { parent: t.id, state: "all" }));
    } catch {
      subtasks = [];
    }

    return {
      project: projectMeta(projects, p),
      task: {
        id: t.id,
        state: t.state,
        status: t.status,
        title: t.title,
        description: t.description,
        // The prompt an agent receives. Only worth the tokens when it exists —
        // on a plain to-do it is null by design.
        ...(t.body ? { body: t.body } : {}),
        tags: t.tags,
        due: t.due,
        agent: t.agent,
        priority: t.priority,
        reminder_frequency: t.reminder_frequency,
        category: t.category,
        ...(t.location ? { location: t.location } : {}),
        ...(t.parent ? { parent: t.parent } : {}),
        source: t.source,
        created_at: t.created_at,
        updated_at: t.updated_at,
        ...(t.done_at ? { done_at: t.done_at } : {}),
        ...(t.dropped_at ? { dropped_at: t.dropped_at } : {}),
        ...(subtasks.length ? { subtasks } : {}),
        comment_count: t.comment_count ?? (t.comments?.length || 0),
        ...(comments === false
          ? {}
          : { comments: (t.comments || []).map((c) => ({ ts: c.ts, by: c.by, text: c.text })) }),
      },
    };
  },
};
