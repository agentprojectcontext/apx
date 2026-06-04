import path from "node:path";
import { agentSkills, buildAgentSystem as buildCoreAgentSystem } from "../../../core/agent-system.js";

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

export function createPermissionGuard(globalConfig = {}, { implicitConfirmation = false } = {}) {
  const permissionMode = globalConfig.super_agent?.permission_mode || "automatico";
  const allowedTools = new Set(globalConfig.super_agent?.allowed_tools || []);

  return function requirePermission(tool, { dangerous = false, confirmed = false } = {}) {
    const ok = confirmed || implicitConfirmation;
    if (permissionMode === "total") return;
    if (permissionMode === "permiso" && !allowedTools.has(tool) && !ok) {
      throw new Error(`requires_confirmation: permission_mode=permiso blocks ${tool}`);
    }
    if (permissionMode === "automatico" && dangerous && !ok) {
      throw new Error(`requires_confirmation: permission_mode=automatico requires confirmation for ${tool}`);
    }
  };
}

export function confirmedProperty(description) {
  return {
    type: "boolean",
    description: description || "true only after explicit user confirmation for this exact action",
  };
}
