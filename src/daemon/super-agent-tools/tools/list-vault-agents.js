import { readVaultAgents, VAULT_DIR } from "../../../core/parser.js";
import { agentRow } from "../helpers.js";

export default {
  name: "list_vault_agents",
  schema: {
    type: "function",
    function: {
      name: "list_vault_agents",
      description: "List reusable agent templates from the APX vault (~/.apx/agents). These can be imported into default or a project.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  makeHandler: () => () => ({
    vault: VAULT_DIR,
    agents: readVaultAgents().map(agentRow),
  }),
};
