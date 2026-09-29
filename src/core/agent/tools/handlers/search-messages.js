import { searchProjectMessages, searchGlobalMessages } from "#core/stores/messages.js";
import { readWhatsAppHistory } from "#core/channels/whatsapp/thread.js";
import { CHANNELS } from "#core/constants/channels.js";
import { resolveProject } from "../helpers.js";

const LIMIT = 25;

const shape = (m) => ({
  ts: m.ts,
  channel: m.channel,
  direction: m.direction,
  type: m.type,
  author: m.author,
  actor_id: m.actor_id,
  body: m.body,
});

export default {
  name: "search_messages",
  schema: {
    type: "function",
    function: {
      name: "search_messages",
      description:
        "Full-text search over the message history: the project ledger AND the global channels " +
        "(telegram, whatsapp, web, desktop…). Narrow with `channel`; for WhatsApp, `contact` " +
        "(name, number or JID) limits it to one person's conversation.",
      parameters: {
        type: "object",
        properties: {
          project: { type: "string" },
          query: { type: "string" },
          channel: { type: "string", description: "only this channel, e.g. whatsapp, telegram, a2a" },
          contact: { type: "string", description: "WhatsApp only: whose conversation to search" },
        },
        required: ["query"],
      },
    },
  },
  makeHandler: ({ projects }) => ({ project, query, channel, contact } = {}) => {
    if (!query) throw new Error("search_messages: query required");
    if (channel === CHANNELS.WHATSAPP || contact) {
      return readWhatsAppHistory({ contact, query, limit: LIMIT });
    }
    const p = resolveProject(projects, project);
    const local = searchProjectMessages(p.path, query, LIMIT)
      .filter((m) => !channel || m.channel === channel);
    // Every global channel lives outside the project; without this half the
    // search could not find anything said on Telegram or WhatsApp.
    const global = searchGlobalMessages(query, { channels: channel ? [channel] : null, limit: LIMIT });
    return [...local, ...global]
      .sort((a, b) => (b.ts || "").localeCompare(a.ts || ""))
      .slice(0, LIMIT)
      .map(shape);
  },
};
