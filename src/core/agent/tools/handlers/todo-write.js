// The model's own checklist for a multi-step job. Writing the plan down is what
// keeps a long turn from forgetting step four; the list rides in the trace, so
// the owner watches it tick in the UI. Whole-list replace, like Claude Code's
// TodoWrite: the model sends the current state of every item each time.
const STATUSES = ["pending", "in_progress", "completed", "blocked"];

export default {
  name: "todo_write",
  schema: {
    type: "function",
    function: {
      name: "todo_write",
      description:
        "Keep a checklist for work with 3+ steps. Send the WHOLE list every time (it replaces the previous one): " +
        "mark an item in_progress before starting it and completed as soon as it is done; one in_progress at a time. " +
        "Use `blocked` with a note when something outside you stops an item.",
      parameters: {
        type: "object",
        properties: {
          todos: {
            type: "array",
            items: {
              type: "object",
              properties: {
                content: { type: "string" },
                status: { type: "string", enum: STATUSES },
                note: { type: "string" },
              },
              required: ["content", "status"],
            },
          },
        },
        required: ["todos"],
      },
    },
  },
  makeHandler: ({ toolSession }) => ({ todos }) => {
    if (!Array.isArray(todos)) return { error: "todos must be an array of {content, status}" };
    const clean = todos
      .filter((t) => t && String(t.content || "").trim())
      .map((t) => ({
        content: String(t.content).trim(),
        status: STATUSES.includes(t.status) ? t.status : "pending",
        ...(t.note ? { note: String(t.note) } : {}),
      }));
    if (toolSession) toolSession.todos = clean;
    const count = (s) => clean.filter((t) => t.status === s).length;
    return {
      ok: true,
      todos: clean,
      summary: `${count("completed")}/${clean.length} done` +
        (count("blocked") ? `, ${count("blocked")} blocked` : "") +
        (count("in_progress") ? `, working on: ${clean.find((t) => t.status === "in_progress").content}` : ""),
    };
  },
};
