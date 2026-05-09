import { readProjectMessages } from "../../../core/messages-store.js";
import { resolveProject } from "../helpers.js";

export default {
  name: "tail_messages",
  schema: {
    type: "function",
    function: {
      name: "tail_messages",
      description: "Tail project messages. Optional filter by channel and/or agent slug.",
      parameters: {
        type: "object",
        properties: {
          project: { type: "string" },
          channel: { type: "string", description: "e.g. telegram, engine, a2a, runtime, heartbeat" },
          agent: { type: "string", description: "agent slug" },
          limit: { type: "integer", description: "max rows; default 20" },
        },
        required: [],
      },
    },
  },
  makeHandler: ({ projects }) => ({ project, channel, agent, limit = 20 } = {}) => {
    const p = resolveProject(projects, project);
    return readProjectMessages(p.path, {
      channel,
      agent_slug: agent,
      limit: Math.min(limit, 100),
    }).map((m) => ({
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
