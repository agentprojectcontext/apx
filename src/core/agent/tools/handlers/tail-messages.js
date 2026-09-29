import { readProjectMessages } from "#core/stores/messages.js";
import { readWhatsAppHistory } from "#core/channels/whatsapp/thread.js";
import { CHANNELS } from "#core/constants/channels.js";
import { resolveProject } from "../helpers.js";

export default {
  name: "tail_messages",
  schema: {
    type: "function",
    function: {
      name: "tail_messages",
      description:
        "Tail recent messages. Project ledger by default (filter by channel and/or agent slug). " +
        "channel \"whatsapp\" — or any `contact` — reads the WhatsApp line instead: every chat, or one " +
        "person's by name, number or JID (\"owner\" for the owner's own thread).",
      parameters: {
        type: "object",
        properties: {
          project: { type: "string" },
          channel: { type: "string", description: "e.g. whatsapp, telegram, engine, a2a, runtime, heartbeat" },
          agent: { type: "string", description: "agent slug" },
          contact: {
            type: "string",
            description: "WhatsApp only: a name, nickname, phone number or JID — returns that person's conversation",
          },
          limit: { type: "integer", description: "max rows; default 20" },
        },
        required: [],
      },
    },
  },
  makeHandler: ({ projects }) => ({ project, channel, agent, contact, limit = 20 } = {}) => {
    // WhatsApp is a global channel: its rows are in ~/.apx/messages/whatsapp,
    // which the project ledger below never opens.
    if (channel === CHANNELS.WHATSAPP || contact) {
      return readWhatsAppHistory({ contact, limit: Math.min(limit, 100) });
    }
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
