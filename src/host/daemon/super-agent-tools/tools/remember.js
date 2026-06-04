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
        "Save a durable fact to your cross-channel notebook (~/.apx/memory.md) so you still know it in future sessions AND on other channels (telegram, web, deck, voice). Use it at the END of any turn where something important happened: a decision taken, a task completed, a key datum agreed, or a relevant tool result — anything you'd want to know if the owner brought it up from a different channel. NOT for one-off TODOs (use create_task) and NOT for project-agent memory. Keep each note to one self-contained sentence.",
      parameters: {
        type: "object",
        required: ["note"],
        properties: {
          note: {
            type: "string",
            description:
              "One durable, self-contained fact to remember, in the owner's language. e.g. 'Manu prefers terse replies with no trailing summaries'.",
          },
          channel: {
            type: "string",
            description:
              "Optional: the channel this happened on (telegram, web, deck, voice…). Usually leave it empty — the current channel is tagged automatically.",
          },
        },
      },
    },
  },
  makeHandler: (ctx = {}) => ({ note, channel } = {}) => {
    if (!note || !String(note).trim()) return { error: "note required" };
    try {
      const r = appendSelfMemory(note, { channel: channel || ctx.channel || "" });
      return { saved: true, note: r.note };
    } catch (e) {
      return { error: e?.message || String(e) };
    }
  },
};
