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
import { formerSlugs, readAgents } from "#core/apc/parser.js";
import { apcAgentFile } from "#core/apc/paths.js";
import { writeAgentFile, ensureAgentDir, removeImportedAgent } from "#core/apc/scaffold.js";
import { setFrontmatterField } from "#core/apc/frontmatter.js";
import { ensureAgentRuntimeDir, agentMemoryPath, agentRuntimeDir, readAgentMemory, writeAgentMemory } from "#core/agent/memory.js";
import { isBlobKey, normalizeAgentType, pickBlob } from "#core/apc/agent-identity.js";
import { readOrganization, resolveAreaSlug } from "#core/stores/organization.js";
import { repointAgentReferences, findStaleAgentMentions } from "./agent-rename-refs.js";
import { normalizeAutonomy } from "#core/constants/permissions.js";

export const AGENT_SLUG_RE = /^[a-z][a-z0-9_-]*$/;

// Autonomy mirrors the permission modes and lives with them now, next to the
// values it validates against. Re-exported here because this module is where
// callers already reach for agent-frontmatter helpers.
export { normalizeAutonomy };

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

// Strip a trailing " (2)" / "-2" style copy marker so cloning a clone doesn't
// stack them ("candela (2) (3)"): it re-derives the base and picks the next free
// index instead.
const stripNameCopy = (name) => name.replace(/\s*\(\d+\)\s*$/, "").trim();
const stripSlugCopy = (slug) => slug.replace(/-\d+$/, "");

/**
 * The lowest free `<base>-<n>` (n from 2) against the slugs already taken, plus
 * the index it landed on — the caller needs the number to build a matching
 * display name.
 */
export function nextIndexedSlug(base, taken) {
  const set = taken instanceof Set ? taken : new Set(taken || []);
  const root = stripSlugCopy(base) || base;
  let n = 2;
  while (set.has(`${root}-${n}`)) n += 1;
  return { slug: `${root}-${n}`, index: n };
}

/**
 * The slug to give a NEW agent named `base` in a project that may already have
 * one. `base` itself when it is free, then each candidate in order — a pack
 * declares readable alternatives ("finance-lead" for a second CFO) so a team
 * does not end up full of `-2` suffixes — and only then the numeric fallback.
 */
export function nextFreeSlug(base, taken, candidates = []) {
  const set = taken instanceof Set ? taken : new Set(taken || []);
  const root = stripSlugCopy(base) || base;
  for (const c of [root, ...candidates]) {
    if (c && AGENT_SLUG_RE.test(c) && !set.has(c)) return c;
  }
  return nextIndexedSlug(root, set).slug;
}

/**
 * Duplicate an existing agent into a fresh slug. Copies every frontmatter field
 * and the system prompt verbatim, appending " (n)" to the display Name and "-n"
 * to the slug — n being the lowest index that keeps both unique — and carries
 * the agent's memory across so the clone starts where the original was. Throws
 * if the source doesn't exist. Caller rebuilds the registry.
 *
 * @param {{path:string}} project
 * @param {string} slug  source agent slug
 * @returns {string} the new (cloned) slug
 */
export function cloneAgent(project, slug) {
  if (!slug) throw new Error("slug required");
  const roster = readAgents(project.path);
  const source = roster.find((a) => a.slug === slug);
  if (!source) throw new Error(`agent ${slug} not found`);

  const taken = new Set(roster.map((a) => a.slug));
  const { slug: newSlug, index: n } = nextIndexedSlug(source.slug, taken);
  if (!AGENT_SLUG_RE.test(newSlug)) throw new Error(`cannot derive a valid slug from "${slug}"`);

  const fields = { ...(source.fields || {}) };
  const baseName = stripNameCopy(fields.Name || source.name || source.slug);
  fields.Name = `${baseName} (${n})`;

  writeAgentFile(project.path, newSlug, fields, source.body || "");
  ensureAgentDir(project.path, newSlug);
  ensureAgentRuntimeDir(project, newSlug);
  const memory = readAgentMemory(project, source.slug);
  if (memory && memory.trim()) writeAgentMemory(project, newSlug, memory);
  return newSlug;
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
 * Rename an agent's slug — the agent's physical key. The slug names the
 * definition file (`.apc/agents/<slug>.md`) and the runtime dir (memory,
 * conversations, sessions under `agents/<slug>/`); it is ALSO written into
 * other agents' `Parent` field and into stores that live nowhere near the agent
 * (group rosters, telegram routes, tasks, deliveries, code sessions, the RAG
 * scope). This moves the files and repoints every one of those, in ONE place so
 * the route and any tool share the same behavior — see agent-rename-refs.js for
 * which references are pointers (repointed) and which are records (left alone:
 * a ledger row's `agent_slug` says who spoke, it does not resolve to anyone).
 *
 * Caller rebuilds the daemon registry afterwards.
 *
 * @param {{id?:any, path:string, storagePath?:string, apxId?:string}} project
 * @param {string} oldSlug  current slug
 * @param {string} newSlug  desired slug (already slugified/validated by caller,
 *   re-validated here against AGENT_SLUG_RE)
 * @param {{projects?:object[], name?:string|null}} [opts]
 *   - `projects`: the daemon registry when the caller has one — reaches rooms
 *     hosted by other projects and telegram fallbacks.
 *   - `name`: the DISPLAY name to land in the same move. Renaming is two
 *     changes to one identity — the slug (the key) and the Name (what a person
 *     reads) — and the web does them as two calls, which is fine when a human
 *     is driving both. Anything else (a tool, a script) doing only half leaves
 *     an agent whose card says "Nati" under the slug `vera`. `undefined`
 *     leaves the name alone; `null`/`""` clears it.
 * @returns {Promise<{slug:string, name:string|null, moved:object,
 *   mentions:{kind:string, agent:string|null, term:string}[]}>}
 *   `moved` is what the sweep repointed, per store; `mentions` is the prose
 *   that still says the old name and was deliberately NOT rewritten.
 */
export async function renameAgent(project, oldSlug, newSlug, opts = {}) {
  const { projects = null, name } = opts;
  if (!oldSlug) throw new Error("current slug required");
  if (!newSlug) throw new Error("new slug required");
  if (!AGENT_SLUG_RE.test(newSlug)) throw new Error(`invalid slug "${newSlug}"`);

  const roster = readAgents(project.path);
  const source = roster.find((a) => a.slug === oldSlug);
  if (!source) throw new Error(`agent ${oldSlug} not found`);
  const oldName = source.fields?.Name || source.name || null;

  // A no-op on the slug is not necessarily a no-op on the rename: "call it
  // Orquestador" against the slug it already has is a display-name change, and
  // returning early used to drop it on the floor.
  if (newSlug === oldSlug) {
    const renamedOnly = name !== undefined && name !== oldName;
    if (renamedOnly) setAgentConfig(project, oldSlug, { name: name || null });
    return {
      slug: oldSlug,
      name: renamedOnly ? (name || null) : oldName,
      moved: {},
      mentions: renamedOnly
        ? findStaleAgentMentions(project, { oldSlug, oldName, newSlug })
        : [],
    };
  }
  if (roster.find((a) => a.slug === newSlug)) throw new Error(`agent ${newSlug} already exists`);

  // 1) Move the definition file. If it's missing — the agent lived only in the
  //    runtime, or only in the VAULT (imported: no local file at all, resolved
  //    through `.apc/project.json`'s `agents.imported`) — re-materialize it
  //    under the new slug from what we parsed. Either way the old slug must
  //    stop resolving, so the import entry goes with it: left behind, the vault
  //    template kept answering to the old slug and the rename read as a
  //    DUPLICATE — one card with the chats, one with the history.
  //
  //    The display name rides along in this same write: one file, one rewrite,
  //    no window where the card is half-renamed.
  const fields = { ...(source.fields || {}) };
  if (name !== undefined) {
    if (name === null || name === "") delete fields.Name;
    else fields.Name = name;
  }
  // Ledger rows keep the old author. Faces and send_to_agent resolve through
  // this so a rename does not leave a grey disc or a dead address.
  const aliases = [...new Set([...formerSlugs(source), oldSlug])].filter((s) => s && s !== newSlug);
  fields.Aliases = aliases;
  const oldFile = apcAgentFile(project.path, oldSlug);
  const hadFile = fs.existsSync(oldFile);
  ensureAgentDir(project.path, newSlug);
  if (hadFile) fs.renameSync(oldFile, apcAgentFile(project.path, newSlug));
  // Re-serialize only when there is something new to say: a plain slug move
  // keeps the file byte-for-byte (a hand-edited card is somebody's work, not
  // ours to reformat), while a name change or a materialized vault agent has
  // to be written. Aliases always land: a slug-only move patches that one
  // field rather than rewriting the prompt.
  if (!hadFile || name !== undefined) {
    writeAgentFile(project.path, newSlug, fields, source.body || "");
  } else {
    const dest = apcAgentFile(project.path, newSlug);
    const text = fs.readFileSync(dest, "utf8");
    fs.writeFileSync(dest, setFrontmatterField(text, "aliases", aliases.join(", ")));
  }
  removeImportedAgent(project.path, oldSlug);

  // 2) Move the runtime dir (memory, conversations, sessions) wholesale.
  const oldDir = agentRuntimeDir(project, oldSlug);
  const newDir = agentRuntimeDir(project, newSlug);
  if (fs.existsSync(oldDir)) {
    if (fs.existsSync(newDir)) throw new Error(`runtime data for ${newSlug} already exists`);
    fs.renameSync(oldDir, newDir);
  }

  // 3) Repoint child agents whose Parent pointed at the old slug.
  let children = 0;
  for (const child of roster) {
    if (child.slug === oldSlug) continue;
    if (child.fields?.Parent === oldSlug) {
      writeAgentFile(project.path, child.slug, { ...child.fields, Parent: newSlug }, child.body || "");
      children += 1;
    }
  }

  // 4) Repoint every other live reference — routines, group rosters, tasks,
  //    deliveries, code sessions, background jobs, board hooks, telegram
  //    routes, the project's own config and the RAG scope. Best-effort per
  //    store: the files have already moved, so one unreadable store must not
  //    fail the rename.
  let moved = {};
  try {
    moved = await repointAgentReferences(project, oldSlug, newSlug, { projects });
  } catch { /* best-effort */ }

  return {
    slug: newSlug,
    name: name !== undefined ? (name || null) : oldName,
    moved: { ...moved, children },
    // What the sweep could not touch without rewriting someone's prose. The
    // caller decides whether to surface it; nothing here is an error.
    mentions: findStaleAgentMentions(project, { oldSlug, oldName, newSlug }),
  };
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

  // Whoever reported to this agent now reports to ITS parent — the ordinary
  // answer when a link is cut out of a chain, and the one renameAgent has
  // always given. Remove did not: deleting a lead left every report carrying
  // `Parent: <a slug that is gone>`, which resolves to nothing and drops them
  // to the top level with no error anywhere. Installing a team, deciding you
  // did not want its lead after all and deleting it is a completely normal
  // sequence, and it silently took the team apart.
  //
  // Read before the file is gone: the grandparent lives in the frontmatter we
  // are about to delete.
  const roster = readAgents(project.path);
  const grandparent = roster.find((a) => a.slug === slug)?.fields?.Parent || null;
  const orphans = roster.filter((a) => a.slug !== slug && a.fields?.Parent === slug);

  if (fs.existsSync(file)) fs.rmSync(file);
  if (fs.existsSync(runtimeDir)) fs.rmSync(runtimeDir, { recursive: true, force: true });

  for (const child of orphans) {
    writeAgentFile(project.path, child.slug, { ...child.fields, Parent: grandparent }, child.body || "");
  }
  return slug;
}
