import path from "node:path";
import { agentSkills, buildAgentSystem as buildCoreAgentSystem } from "../../../core/agent/build-agent-system.js";
import { buildConfirmDescription } from "../../../core/confirmation/index.js";
import { PERMISSION_MODES, DEFAULT_PERMISSION_MODE } from "../../../core/constants/permissions.js";

export function projectMeta(projects, entry) {
  const meta = projects.list().find((p) => p.id === entry.id);
  return {
    id: entry.id,
    name: meta?.name || path.basename(entry.path),
    path: entry.path,
  };
}

export function resolveProject(projects, target, { allowMulti = false } = {}) {
  if (target === undefined || target === null || target === "") {
    if (allowMulti) return null;
    const defaultProject = projects.get(0);
    if (defaultProject) return defaultProject;
    const all = projects.list();
    if (all.length === 1) return projects.get(all[0].id);
    throw new Error(`multiple projects registered (${all.length}); specify project=<id|name|path>`);
  }

  const tgt = String(target);
  if (tgt.toLowerCase() === "default") {
    const defaultProject = projects.get(0);
    if (!defaultProject) throw new Error("default project not available");
    return defaultProject;
  }

  if (typeof target === "number" || /^\d+$/.test(tgt)) {
    const entry = projects.get(parseInt(tgt, 10));
    if (!entry) throw new Error(`project id ${target} not found`);
    return entry;
  }

  const all = projects.list();
  const byPath = all.find((p) => p.path === path.resolve(tgt));
  if (byPath) return projects.get(byPath.id);

  const byName = all.find((p) => p.name === tgt);
  if (byName) return projects.get(byName.id);

  const tgtLow = tgt.toLowerCase();
  const fuzzy = all.filter(
    (p) => p.name.toLowerCase().includes(tgtLow) || p.path.toLowerCase().includes(tgtLow)
  );
  if (fuzzy.length === 1) return projects.get(fuzzy[0].id);
  if (fuzzy.length > 1) {
    throw new Error(`project "${tgt}" is ambiguous; matches: ${fuzzy.map((p) => p.name).join(", ")}`);
  }
  throw new Error(`project "${tgt}" not found`);
}

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

