// Shared helpers for the Asana agent tools (asana-*.js). Kept in an underscore
// file — like _git.js — so it holds no tool `name:` of its own. Each tool file
// stays a thin adapter: resolve the project's effective Asana integration (its
// own record wins over the default project's — see resolveIntegration), then
// call the pure REST client in core/integrations/plugins/asana.js.
import { resolveProject } from "../helpers.js";
import { resolveIntegration } from "#core/integrations/index.js";

// Resolve the active Asana token + config for a project, or throw a message the
// model can act on (tell the user to connect Asana in the web panel).
export function resolveAsana(projects, project) {
  const p = resolveProject(projects, project);
  const resolved = resolveIntegration({ projectStorage: p.storagePath, slug: "asana" });
  if (!resolved) {
    throw new Error(
      "Asana is not connected for this project. Ask the user to connect it in the web panel → Integrations → Plugins → Asana.",
    );
  }
  const config = resolved.record.config || {};
  const token = config.personal_access_token;
  if (!token) throw new Error("Asana integration has no token configured");
  return { token, config, scope: resolved.scope };
}

export function requireWorkspace(config) {
  const gid = config.workspace_gid;
  if (!gid) throw new Error("No Asana workspace selected. Configure it in the web panel first.");
  return gid;
}

// The optional `project` arg every Asana tool accepts (defaults to current).
export const PROJECT_ARG = {
  project: { type: "string", description: "APX project id/name (optional; defaults to current)" },
};
