import { searchProjectMessages } from "../../../../core/stores/messages.js";
import { resolveProject } from "../helpers.js";

export default {
  name: "search_messages",
  schema: {
    type: "function",
    function: {
      name: "search_messages",
      description: "Full-text search inside project messages.",
      parameters: {
        type: "object",
        properties: {
          project: { type: "string" },
          query: { type: "string" },
        },
        required: ["query"],
      },
    },
  },
  makeHandler: ({ projects }) => ({ project, query }) => {
    if (!query) throw new Error("search_messages: query required");
    const p = resolveProject(projects, project);
    return searchProjectMessages(p.path, query, 25).map((m) => ({
      ts: m.ts,
      channel: m.channel,
      direction: m.direction,
      type: m.type,
      author: m.author,
      actor_id: m.actor_id,
      body: m.body,
    }));
  },
};
