import * as obsidian from "#core/integrations/plugins/obsidian.js";
import { resolveObsidian, PROJECT_ARG } from "./_obsidian.js";

export default {
  name: "obsidian_search_notes",
  category: "integrations",
  schema: {
    type: "function",
    function: {
      name: "obsidian_search_notes",
      description:
        "Search notes in the active Obsidian vault by text. Matches note bodies and filenames; returns a short snippet per hit.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Text to search for" },
          limit: { type: "number", description: "Max results (default 50)" },
          ...PROJECT_ARG,
        },
        required: ["query"],
      },
    },
  },
  makeHandler:
    ({ projects }) =>
    async ({ project, query, limit = 50 } = {}) => {
      const { vaultPath } = resolveObsidian(projects, project);
      return { results: obsidian.searchNotes(vaultPath, query, { limit }) };
    },
};
