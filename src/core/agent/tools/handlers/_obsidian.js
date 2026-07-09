// Shared helper for the Obsidian agent tools (obsidian-*.js). Underscore file —
// like _asana.js / _git.js — so it declares no tool `name:` of its own. Each
// tool stays a thin adapter: resolve the project's effective Obsidian vault (its
// own record wins over the default project's — see resolveIntegration), then
// call the pure filesystem client in core/integrations/plugins/obsidian.js.
import { resolveProject } from "../helpers.js";
import { resolveIntegration } from "#core/integrations/index.js";
import { resolveVaultPath } from "#core/integrations/plugins/obsidian.js";

// Resolve the active Obsidian vault for a project, or throw a message the model
// can act on (tell the user to connect a vault).
export function resolveObsidian(projects, project) {
  const p = resolveProject(projects, project);
  const resolved = resolveIntegration({ projectStorage: p.storagePath, slug: "obsidian" });
  if (!resolved) {
    throw new Error(
      "Obsidian is not connected for this project. Ask the user to connect a Vault in the web panel → Integrations → Plugins → Obsidian, or run `apx obsidian set <path>`.",
    );
  }
  const config = resolved.record.config || {};
  if (!config.vault_path) throw new Error("Obsidian integration has no vault path configured");
  return { vaultPath: resolveVaultPath(config.vault_path), config, scope: resolved.scope };
}

// The optional `project` arg every Obsidian tool accepts (defaults to current).
export const PROJECT_ARG = {
  project: { type: "string", description: "APX project id/name (optional; defaults to current)" },
};
