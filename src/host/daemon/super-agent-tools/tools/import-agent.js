import fs from "node:fs";
import path from "node:path";
import { readVaultAgents, VAULT_DIR } from "../../../../core/parser.js";
import { addImportedAgent, ensureAgentDir } from "../../../../core/scaffold.js";
import { confirmedProperty, projectMeta, resolveProject } from "../helpers.js";

export default {
  name: "import_agent",
  schema: {
    type: "function",
    function: {
      name: "import_agent",
      description: "Import an agent template from the APX vault into default or a registered project.",
      parameters: {
        type: "object",
        properties: {
          project: { type: "string", description: "project id/name/path; omit or use 'default' for ~/.apx/projects/default" },
          agent: { type: "string", description: "agent slug from list_vault_agents" },
          confirmed: confirmedProperty("true only after explicit user confirmation for this exact import"),
        },
        required: ["agent"],
      },
    },
  },
  makeHandler: ({ projects, requirePermission }) => ({ project, agent: slug, confirmed = false }) => {
    requirePermission("import_agent", { dangerous: true, confirmed });
    if (!slug) throw new Error("import_agent: agent required");

    const vaultPath = path.join(VAULT_DIR, `${slug}.md`);
    if (!fs.existsSync(vaultPath)) {
      const available = readVaultAgents().map((a) => a.slug).join(", ") || "(none)";
      throw new Error(`agent "${slug}" not found in vault. Available: ${available}`);
    }

    const p = resolveProject(projects, project || "default");
    addImportedAgent(p.path, slug);
    ensureAgentDir(p.path, slug);
    projects.rebuild(p.id);

    return {
      ok: true,
      agent: slug,
      project: projectMeta(projects, p),
      source: vaultPath,
    };
  },
};
