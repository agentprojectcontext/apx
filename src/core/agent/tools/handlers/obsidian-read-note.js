import * as obsidian from "#core/integrations/plugins/obsidian.js";
import { resolveObsidian, PROJECT_ARG } from "./_obsidian.js";

export default {
  name: "obsidian_read_note",
  category: "integrations",
  schema: {
    type: "function",
    function: {
      name: "obsidian_read_note",
      description: "Read the full contents of a note in the active Obsidian vault.",
      parameters: {
        type: "object",
        properties: {
          note: {
            type: "string",
            description: "Vault-relative note path, e.g. 'Folder/Note.md' (the .md is optional)",
          },
          ...PROJECT_ARG,
        },
        required: ["note"],
      },
    },
  },
  makeHandler:
    ({ projects }) =>
    async ({ project, note } = {}) => {
      const { vaultPath } = resolveObsidian(projects, project);
      return { note, content: obsidian.readNote(vaultPath, note) };
    },
};
