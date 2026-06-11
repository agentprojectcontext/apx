// Pure / config-only helpers used by tool handlers. Anything that needs the
// running daemon's projects registry (projectMeta, resolveProject) lives in
// host/daemon/projects-helpers.js and is re-exported here for back-compat.
import path from "node:path";
import { agentSkills, buildAgentSystem as buildCoreAgentSystem } from "#core/agent/build-agent-system.js";
import { buildConfirmDescription } from "#core/confirmation/index.js";
import { PERMISSION_MODES, DEFAULT_PERMISSION_MODE } from "#core/constants/permissions.js";

export { projectMeta, resolveProject } from "#host/daemon/projects-helpers.js";

export function safePathJoin(root, sub = ".") {
  const target = path.resolve(root, sub || ".");
  const rootResolved = path.resolve(root);
  if (target !== rootResolved && !target.startsWith(rootResolved + path.sep)) {
    throw new Error(`path "${sub}" escapes the project root`);
  }
  return target;
}

export function skillsFromFields(fields = {}) {
  return agentSkills({ fields });
}

export function agentRow(agent) {
  return {
    slug: agent.slug,
    role: agent.fields.Role || null,
    model: agent.fields.Model || null,
    language: agent.fields.Language || null,
    description: agent.fields.Description || null,
    skills: skillsFromFields(agent.fields),
  };
}

export function buildAgentSystem(project, agent, opts = {}) {
  return buildCoreAgentSystem(project, agent, opts);
}

export function createPermissionGuard(globalConfig = {}, {
  requestConfirmation = null,
} = {}) {
  const permissionMode = globalConfig.super_agent?.permission_mode || DEFAULT_PERMISSION_MODE;
  const allowedTools = new Set(globalConfig.super_agent?.allowed_tools || []);

  // async so tools can `await requirePermission(...)` and the confirmation
  // dialog resolves transparently before execution continues. The model never
  // self-approves: the only path past a blocked call is the interface's own
  // confirmation dialog via the requestConfirmation callback.
  return async function requirePermission(tool, { dangerous = false, args } = {}) {
    if (permissionMode === PERMISSION_MODES.TOTAL) return;

    const blocked =
      (permissionMode === PERMISSION_MODES.PERMISO && !allowedTools.has(tool)) ||
      (permissionMode === PERMISSION_MODES.AUTOMATICO && dangerous);

    if (!blocked) return;

    const description = buildConfirmDescription(tool, args || {});

    if (!requestConfirmation) {
      // No confirmation channel wired for this invocation context (e.g. routine,
      // autonomous agent). Surface a clear message so the model can explain it.
      throw new Error(`Action requires user confirmation: ${description}`);
    }

    const userConfirmed = await requestConfirmation(tool, args || {}, description);

    if (!userConfirmed) {
      throw new Error(`User did not confirm: ${description}`);
    }
    // Confirmed — fall through, tool executes normally.
  };
}

