import { addComment } from "#core/stores/tasks.js";
import { mentionedAgents } from "#core/tasks/comment-turn.js";
import { missingArg, projectMeta, resolveProject } from "../helpers.js";

// Leave a comment on a task. The write-up half of working on one: an agent that
// reviewed, tested or fixed something says so where the task is, instead of the
// result living only in a chat nobody will scroll back to.
//
// IT DOES NOT SUMMON ANYONE. Mentions are recorded on the comment (so the thread
// says who it was addressed to) but writing one here starts no agent turn. Only
// the owner's own comment — and the cascade already running under its ceiling —
// can do that. Otherwise an agent mid-cascade could open a second cascade from
// inside its own turn, and the ceiling that makes the whole thing safe would be
// counting one thread while several ran. Handing work to another agent is done
// by naming them in the REPLY, which the cascade scans.
export default {
  name: "comment_task",
  schema: {
    type: "function",
    function: {
      name: "comment_task",
      description:
        "Add a comment to a task's thread. Use it to report what you found or did while working on a " +
        "task — a QA verdict, a review note, what is blocking you — so it stays attached to the task " +
        "instead of only in this conversation. Keep it to a few lines: it renders in a side panel next " +
        "to the task. Call list_tasks first if you do not have the task id.",
      parameters: {
        type: "object",
        required: ["task", "text"],
        properties: {
          task:    { type: "string", description: "Task id or unique id prefix (≥3 chars)." },
          text:    { type: "string", description: "The comment. A few lines. Lead with the conclusion." },
          project: { type: "string", description: "Project id, name or path. Defaults to 'default'." },
        },
      },
    },
  },
  makeHandler: ({ projects, channelMeta }) => async (args = {}) => {
    const { task, text, project } = args;
    if (!task) return missingArg("comment_task", "task", { required: ["task", "text"], optional: ["project"] }, args);
    if (!text || !String(text).trim()) {
      return missingArg("comment_task", "text", { required: ["task", "text"], optional: ["project"] }, args);
    }

    let p;
    try {
      p = resolveProject(projects, project || "default");
    } catch (e) {
      return { error: e.message };
    }

    try {
      // Whoever is running this turn signs the comment. Falling back to a
      // generic id would make every agent's notes indistinguishable in a thread
      // whose entire value is knowing who said what.
      const by = channelMeta?.agentSlug || "agent";
      const mentions = mentionedAgents(text, p.path, by);
      const result = addComment(p.storagePath, task, { by, text, mentions });
      if (!result) return { error: `task not found: ${task}` };
      return {
        ok: true,
        project: projectMeta(projects, p),
        task: { id: result.id, title: result.title, comments: result.comments.length },
        ...(mentions.length
          ? {
              mentions,
              note:
                "Recorded on the comment, but nobody was summoned by this call. " +
                "To hand the work over, name them in your reply text instead.",
            }
          : {}),
      };
    } catch (e) {
      return { error: e.message };
    }
  },
};
