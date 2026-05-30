import { appendSelfMemory } from "../../../../core/agent/self-memory.js";

// Write a durable note into YOUR OWN notebook (~/.apx/memory.md). This is your
// personal, cross-session memory — not a project task and not an agent memory.
export default {
  name: "remember",
  schema: {
    type: "function",
    function: {
      name: "remember",
      description:
        "Save a durable fact to your own notebook (~/.apx/memory.md) so you still know it in future sessions. Use for lasting things: a preference the owner stated, an ongoing thread, a decision, or the gist of what you've been working on (you can skim your recent sessions with search_sessions and jot the summary here). NOT for one-off TODOs (use create_task) and NOT for project-agent memory. Keep each note to one self-contained sentence.",
      parameters: {
        type: "object",
        required: ["note"],
        properties: {
          note: {
            type: "string",
            description:
              "One durable, self-contained fact to remember, in the owner's language. e.g. 'Manu prefers terse replies with no trailing summaries'.",
          },
        },
      },
    },
  },
  makeHandler: () => ({ note } = {}) => {
    if (!note || !String(note).trim()) return { error: "note required" };
    try {
      const r = appendSelfMemory(note);
      return { saved: true, note: r.note };
    } catch (e) {
      return { error: e?.message || String(e) };
    }
  },
};
