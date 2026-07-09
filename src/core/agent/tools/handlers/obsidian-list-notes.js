import * as obsidian from "#core/integrations/plugins/obsidian.js";
import { resolveObsidian, PROJECT_ARG } from "./_obsidian.js";

export default {
  name: "obsidian_list_notes",
  category: "integrations",
  schema: {
    type: "function",
    function: {
      name: "obsidian_list_notes",
      description: "List note paths in the active Obsidian vault (vault-relative, sorted).",
      parameters: {
        type: "object",
        properties: {
          limit: { type: "number", description: "Max notes to return (default 500)" },
          ...PROJECT_ARG,
        },
      },
    },
  },
  makeHandler:
    ({ projects }) =>
    async ({ project, limit = 500 } = {}) => {
      const { vaultPath } = resolveObsidian(projects, project);
      const notes = obsidian.listNotes(vaultPath, { limit });
      return { notes, count: notes.length };
    },
};
