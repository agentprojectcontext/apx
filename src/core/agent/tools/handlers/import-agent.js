import { readVaultAgents, vaultAgentFile } from "#core/apc/parser.js";
import { addImportedAgent, ensureAgentDir } from "#core/apc/scaffold.js";
import { ensureAgentRuntimeDir } from "#core/agent/memory.js";
import { projectMeta, resolveProject } from "../helpers.js";

export default {
  name: "import_agent",
  schema: {
    type: "function",
    function: {
      name: "import_agent",
      description: "Import an agent template from the APX vault into a project. Omit `project` to import into the project you belong to (the default workspace, if you are the super-agent).",
      parameters: {
        type: "object",
        properties: {
          project: { type: "string", description: "Project id, name or path. Omit for the project you belong to (the default project, if you are the super-agent)." },
          agent: { type: "string", description: "agent slug from list_vault_agents" },
        },
        required: ["agent"],
      },
    },
  },
  makeHandler: ({ projects, requirePermission }) => async ({ project, agent: slug, confirmed = false }) => {
    await requirePermission("import_agent", { dangerous: true, confirmed, args: { agent: slug } });
    if (!slug) throw new Error("import_agent: agent required");

    // Layered lookup (user file → bundled default). A raw path into the user
    // vault would reject every bundled agent this same error message lists.
    const vaultPath = vaultAgentFile(slug);
    if (!vaultPath) {
      const available = readVaultAgents().map((a) => a.slug).join(", ") || "(none)";
      throw new Error(`agent "${slug}" not found in vault. Available: ${available}`);
    }

    const p = resolveProject(projects, project);
    addImportedAgent(p.path, slug);
    ensureAgentDir(p.path, slug);
    ensureAgentRuntimeDir(p, slug);
    projects.rebuild(p.id);

    return {
      ok: true,
      agent: slug,
      project: projectMeta(projects, p),
      source: vaultPath,
    };
  },
};
