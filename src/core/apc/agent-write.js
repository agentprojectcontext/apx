// Creating and re-prompting a project agent — the write side of the agent
// lifecycle, in ONE place (rule 8). The daemon route (host/daemon/api/agents.js)
// and the super-agent's `create_agent` / `set_agent_prompt` tools both call
// here, so slug validation, avatar assignment and field normalization can never
// drift between the surfaces.
//
// The super-agent used to have NO native way to build an agent: asked to create
// one, it shelled out to `apx agent add` (awkward for a long, multi-line system
// prompt) and, when that produced a body-less agent, patched over it by hand-
// writing the `.md` — the exact anti-pattern the apx-agent skill warns against.
// These functions are what the native tools stand on so that never has to happen.
import fs from "node:fs";
import path from "node:path";
import { readAgents } from "#core/apc/parser.js";
import { apcAgentFile } from "#core/apc/paths.js";
import { writeAgentFile, ensureAgentDir } from "#core/apc/scaffold.js";
import { ensureAgentRuntimeDir, agentMemoryPath } from "#core/agent/memory.js";
import { isBlobKey, normalizeAgentType, pickBlob } from "#core/apc/agent-identity.js";
import { readOrganization, resolveAreaSlug } from "#core/stores/organization.js";
import { PERMISSION_MODES } from "#core/constants/permissions.js";

export const AGENT_SLUG_RE = /^[a-z][a-z0-9_-]*$/;

// Autonomy mirrors the super-agent permission modes (total/automatico/permiso).
// An invalid value is dropped rather than persisted so a typo can't silently
// widen an agent's autonomy.
const AUTONOMY_VALUES = new Set(Object.values(PERMISSION_MODES));
export function normalizeAutonomy(v) {
  if (v === undefined) return undefined;
  if (v === null || v === "") return null;
  return AUTONOMY_VALUES.has(v) ? v : undefined;
}

// Build the frontmatter fields for a NEW agent from a loose spec. Throws on an
// invalid `type`. `roster` is the existing agent list, used to pick an avatar
// blob this project isn't already using so a team stays distinguishable.
export function buildNewAgentFields(projectPath, spec = {}, roster = []) {
  const {
    name, role, model, language, description, skills, tools,
    is_master, parent, type, area, emoji, icon, autonomy,
  } = spec;
  const typeVal = normalizeAgentType(type);
  if (type && !typeVal) throw new Error(`invalid type "${type}"`);
  // Every agent gets a face. A caller that doesn't care (CLI, MCP, super-agent)
  // leaves icon empty and one is picked from the blobs this project isn't using.
  const iconVal = isBlobKey(icon)
    ? icon
    : pickBlob({ taken: roster.map((a) => a.fields?.Icon).filter(Boolean) });
  return {
    Name: name || null,
    Role: role || null,
    Model: model || null,
    Language: language || null,
    Description: description || null,
    Skills: skills || [],
    // Omitted tools ⇒ leave the field UNDECLARED. A declared list is a
    // deliberate narrowing that wins forever, so stamping a snapshot of "the
    // defaults" at creation quietly freezes the agent. Undeclared means the
    // broad default (see resolveAgentAllowedTools).
    Tools: Array.isArray(tools) ? tools : null,
    Master: is_master || typeVal === "orchestrator" ? true : null,
    Parent: parent || null,
    Type: typeVal,
    Area: resolveAreaSlug(area, readOrganization(projectPath)),
    Emoji: emoji || null,
    Icon: iconVal,
    Autonomy: normalizeAutonomy(autonomy) || null,
  };
}

/**
 * Create a project agent, writing its `.apc/agents/<slug>.md` (frontmatter +
 * system prompt) and provisioning its runtime dir. Does NOT rebuild the daemon
 * projects registry — that is the caller's job (route/tool), since the registry
 * is a runtime object, not core.
 *
 * @param {{path:string}} project  project descriptor (needs .path; passed
 *   through to ensureAgentRuntimeDir for the runtime/memory dir)
 * @param {object} spec  { slug, system, name?, role?, ... }
 * @param {{requireSystem?:boolean}} opts  when true, a missing/empty `system`
 *   throws instead of writing a body-less agent (the super-agent tool sets this)
 * @returns {string} the created slug
 */
export function createAgent(project, spec = {}, { requireSystem = false } = {}) {
  const { slug, system } = spec;
  if (!slug) throw new Error("slug required");
  if (!AGENT_SLUG_RE.test(slug)) throw new Error(`invalid slug "${slug}"`);
  if (requireSystem && (typeof system !== "string" || !system.trim())) {
    throw new Error(
      "an agent needs a system prompt: pass `system` with the agent's instructions. " +
      "Creating one without a body leaves it unable to do anything.",
    );
  }
  const roster = readAgents(project.path);
  if (roster.find((a) => a.slug === slug)) throw new Error(`agent ${slug} already exists`);
  const fields = buildNewAgentFields(project.path, spec, roster);
  writeAgentFile(project.path, slug, fields, typeof system === "string" ? system : "");
  ensureAgentDir(project.path, slug);
  ensureAgentRuntimeDir(project, slug);
  return slug;
}

/**
 * Replace an existing agent's system prompt (its `.md` body), keeping every
 * frontmatter field. Throws if the agent doesn't exist. Caller rebuilds.
 *
 * @param {{path:string}} project
 * @param {string} slug
 * @param {string} system  the new system prompt (required, non-empty)
 * @returns {string} the slug
 */
export function setAgentPrompt(project, slug, system) {
  if (!slug) throw new Error("slug required");
  if (typeof system !== "string" || !system.trim()) {
    throw new Error("system prompt required: pass `system` with the agent's new instructions.");
  }
  const existing = readAgents(project.path).find((a) => a.slug === slug);
  if (!existing) throw new Error(`agent ${slug} not found`);
  writeAgentFile(project.path, slug, existing.fields || {}, system);
  ensureAgentDir(project.path, slug);
  ensureAgentRuntimeDir(project, slug);
  return slug;
}

/**
 * Merge frontmatter fields into an existing agent (model, type, area, skills,
 * role, …), keeping its body unless `patch.system` is given. Mirrors the PATCH
 * route so the route and the configure_agent tool share one normalization.
 * A field set to null/"" is removed; `undefined` leaves it untouched.
 *
 * @param {{path:string}} project
 * @param {string} slug
 * @param {object} patch
 * @returns {string} the slug
 */
export function setAgentConfig(project, slug, patch = {}) {
  const existing = readAgents(project.path).find((a) => a.slug === slug);
  if (!existing) throw new Error(`agent ${slug} not found`);
  const fields = { ...(existing.fields || {}) };
  const setStr = (key, val) => {
    if (val === undefined) return;
    if (val === null || val === "") delete fields[key];
    else fields[key] = val;
  };
  setStr("Name", patch.name);
  setStr("Role", patch.role);
  setStr("Model", patch.model);
  setStr("Language", patch.language);
  setStr("Description", patch.description);
  setStr("Parent", patch.parent);
  if (patch.type !== undefined && patch.type !== null && patch.type !== "") {
    const t = normalizeAgentType(patch.type);
    if (!t) throw new Error(`invalid type "${patch.type}"`);
    fields.Type = t;
  } else {
    setStr("Type", patch.type);
  }
  if (patch.area !== undefined) {
    const resolved = patch.area === null || patch.area === ""
      ? null
      : resolveAreaSlug(patch.area, readOrganization(project.path));
    setStr("Area", resolved);
  }
  setStr("Emoji", patch.emoji);
  setStr("Icon", patch.icon);
  const auto = normalizeAutonomy(patch.autonomy);
  if (auto !== undefined) setStr("Autonomy", auto);
  if (patch.skills !== undefined) fields.Skills = Array.isArray(patch.skills) ? patch.skills : [];
  if (patch.tools !== undefined) fields.Tools = Array.isArray(patch.tools) ? patch.tools : [];
  if (patch.is_master !== undefined) {
    if (patch.is_master) fields.Master = true;
    else { delete fields.Master; delete fields.Primary; }
  }
  const body = patch.system !== undefined ? patch.system : (existing.body || "");
  writeAgentFile(project.path, slug, fields, body);
  ensureAgentDir(project.path, slug);
  ensureAgentRuntimeDir(project, slug);
  return slug;
}

/**
 * Delete an agent: its `.apc/agents/<slug>.md` definition and its runtime dir
 * (memory, conversations, sessions). Throws if neither exists. Caller rebuilds.
 *
 * @param {{path:string}} project
 * @param {string} slug
 * @returns {string} the slug
 */
export function removeAgent(project, slug) {
  if (!slug) throw new Error("slug required");
  const file = apcAgentFile(project.path, slug);
  const runtimeDir = path.dirname(agentMemoryPath(project, slug));
  if (!fs.existsSync(file) && !fs.existsSync(runtimeDir)) {
    throw new Error(`agent ${slug} not found`);
  }
  if (fs.existsSync(file)) fs.rmSync(file);
  if (fs.existsSync(runtimeDir)) fs.rmSync(runtimeDir, { recursive: true, force: true });
  return slug;
}
