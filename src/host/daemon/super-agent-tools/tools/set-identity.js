import { readIdentity, writeIdentity } from "../../../../core/identity.js";

export default {
  name: "set_identity",
  schema: {
    type: "function",
    function: {
      name: "set_identity",
      description: "Update APX profile identity fields. Persists to ~/.apx/identity.json.",
      parameters: {
        type: "object",
        properties: {
          agent_name: { type: "string", description: "new agent name" },
          owner_name: { type: "string", description: "owner name" },
          owner_context: { type: "string", description: "context injected into every system prompt — what the owner builds / works on" },
          personality: { type: "string", description: "comma-separated personality traits" },
        },
      },
    },
  },
  makeHandler: ({ requirePermission }) => async ({ agent_name, owner_name, owner_context, personality, confirmed = false } = {}) => {
    await requirePermission("set_identity", { dangerous: true, confirmed, args: { agent_name } });
    const fields = {};
    if (agent_name) fields.agent_name = agent_name;
    if (owner_name) fields.owner_name = owner_name;
    if (owner_context !== undefined) fields.owner_context = owner_context;
    if (personality) fields.personality = personality;
    if (Object.keys(fields).length === 0) {
      return { ok: true, identity: readIdentity() };
    }
    return { ok: true, identity: writeIdentity(fields) };
  },
};
