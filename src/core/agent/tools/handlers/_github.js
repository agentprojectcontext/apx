// Shared helper for the GitHub agent tools (github-*.js). Underscore file — no
// tool `name:` of its own. Resolves the project's effective GitHub integration
// (its own record wins over the default project's) and hands back the token.
import { resolveProject } from "../helpers.js";
import { resolveIntegration } from "#core/integrations/index.js";

export function resolveGithub(projects, project) {
  const p = resolveProject(projects, project);
  const resolved = resolveIntegration({ projectStorage: p.storagePath, slug: "github" });
  if (!resolved) {
    throw new Error(
      "GitHub is not connected for this project. Ask the user to connect it in the web panel → Integrations → Plugins → GitHub.",
    );
  }
  const token = resolved.record.config?.token;
  if (!token) throw new Error("GitHub integration has no token configured");
  return { token, scope: resolved.scope };
}

export const PROJECT_ARG = {
  project: { type: "string", description: "APX project id/name (optional; defaults to current)" },
};
