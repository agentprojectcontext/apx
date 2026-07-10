import * as obsidian from "#core/integrations/plugins/obsidian.js";
import { resolveObsidian, PROJECT_ARG } from "./_obsidian.js";

export default {
  name: "obsidian_write_note",
  category: "integrations",
  schema: {
    type: "function",
    function: {
      name: "obsidian_write_note",
      description:
        "Create or update a note in the active Obsidian vault. Use mode 'append' to add to an existing note, otherwise the note is overwritten. Write Obsidian-native markdown: link related notes with [[wikilinks]] and classify with #tags so the vault's graph and backlinks stay connected (e.g. a note about billing might link [[Stripe]] and tag #area/payments).",
      parameters: {
        type: "object",
        properties: {
          note: {
            type: "string",
            description: "Vault-relative note path, e.g. 'Inbox/Idea.md' (the .md is optional; parent folders are created)",
          },
          content: { type: "string", description: "Markdown content to write" },
          mode: {
            type: "string",
            enum: ["overwrite", "append"],
            description: "Write mode (default 'overwrite')",
          },
          ...PROJECT_ARG,
        },
        required: ["note", "content"],
      },
    },
  },
  makeHandler:
    ({ projects }) =>
    async ({ project, note, content, mode = "overwrite" } = {}) => {
      const { vaultPath } = resolveObsidian(projects, project);
      return obsidian.writeNote(vaultPath, note, content, { mode });
    },
};
