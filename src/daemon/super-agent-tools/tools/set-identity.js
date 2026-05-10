import { readIdentity, writeIdentity } from "../../../core/identity.js";
import { confirmedProperty } from "../helpers.js";

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
          personality: { type: "string", description: "comma-separated personality traits" },
          language: { type: "string", description: "preferred language" },
          confirmed: confirmedProperty("true only after explicit user confirmation for this exact identity update"),
        },
      },
    },
  },
  makeHandler: ({ requirePermission }) => ({ agent_name, owner_name, personality, language, confirmed = false } = {}) => {
    requirePermission("set_identity", { dangerous: true, confirmed });
    const fields = {};
    if (agent_name) fields.agent_name = agent_name;
    if (owner_name) fields.owner_name = owner_name;
    if (personality) fields.personality = personality;
    if (language) fields.language = language;
    if (Object.keys(fields).length === 0) {
      return { ok: true, identity: readIdentity() };
    }
    return { ok: true, identity: writeIdentity(fields) };
  },
};
