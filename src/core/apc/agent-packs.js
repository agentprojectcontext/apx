// Packs: installing a TEAM of vault templates in one shot instead of one agent
// at a time.
//
// Why a manifest of its own (assets/agent-vault-packs.json) and not a `pack:`
// field in each template's frontmatter: the frontmatter is a closed vocabulary
// (agentToResponse's `reserved` set, VAULT_PATCH_FIELDS) and an unknown key
// falls into the `extra` bag and gets dropped by normalizeVaultPatch on the
// next edit. A pack is also not a property of one agent — it is a relation
// between several, including who reports to whom, which has nowhere to live in
// a single file.
//
// The one thing a pack must get right is that a team installs into a project
// that already HAS agents: every slug it wants may be taken. So the install is
// planned first (assign every slug, rewrite every Parent against that map) and
// written second — a half-installed team with dangling parents is worse than
// no team.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { readAgents, readVaultAgents } from "#core/apc/parser.js";
import { pickAgentName } from "./agent-names.js";
import { AGENT_VAULT_DIR } from "#core/config/paths.js";
import { ensureAgentRuntimeDir } from "#core/agent/memory.js";
import { readOrganization, createArea, createRole } from "#core/stores/organization.js";
import { writeAgentFile, ensureAgentDir } from "./scaffold.js";
import { buildNewAgentFields, nextFreeSlug, AGENT_SLUG_RE } from "./agent-write.js";

const __dir = path.dirname(fileURLToPath(import.meta.url));

/**
 * Every agent name in play on this machine.
 *
 * Machine-wide on purpose: two agents called Nora in two companies collide in
 * the one place it matters — the owner's inbox, where both write.
 */
export function takenAgentNames({ apxHome = process.env.APX_HOME || path.join(process.env.HOME || "", ".apx") } = {}) {
  const names = new Set();
  let config;
  try {
    config = JSON.parse(fs.readFileSync(path.join(apxHome, "config.json"), "utf8"));
  } catch {
    return names;
  }
  for (const entry of config?.projects ?? []) {
    if (!entry?.path) continue;
    for (const agent of readAgents(entry.path)) {
      const name = agent.fields?.Name;
      if (name) names.add(String(name));
    }
  }
  const superName = config?.super_agent?.name;
  if (superName) names.add(String(superName));
  return names;
}

/** Shipped with APX, read-only — same layering as the agent vault itself. */
export const BUNDLED_PACKS_FILE = path.resolve(__dir, "../../../assets/agent-vault-packs.json");
/** Optional user layer: a pack defined here replaces the bundled one with that id. */
export const USER_PACKS_FILE = path.join(AGENT_VAULT_DIR, "packs.json");

function readPacksFile(file) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    return Array.isArray(parsed?.packs) ? parsed.packs : [];
  } catch {
    return [];
  }
}

/**
 * Every pack, bundled first and user packs overriding by id.
 * @returns {Array<object>}
 */
export function readPacks() {
  const byId = new Map();
  for (const pack of readPacksFile(BUNDLED_PACKS_FILE)) {
    if (pack?.id) byId.set(pack.id, { ...pack, source: "bundled" });
  }
  for (const pack of readPacksFile(USER_PACKS_FILE)) {
    if (pack?.id) byId.set(pack.id, { ...pack, source: "user" });
  }
  return Array.from(byId.values());
}

export function getPack(id) {
  return readPacks().find((p) => p.id === id) || null;
}

// A renamed agent needs a display name that isn't a duplicate of the one
// already in the project. Two shapes read well and nothing else does: a numeric
// collision keeps the name and marks the copy ("CFO (2)"), and a named
// alternative becomes its own title ("finance-lead" → "Finance Lead").
function displayNameFor(baseName, assigned, template) {
  if (assigned === template) return baseName;
  const suffix = assigned.match(/-(\d+)$/);
  if (suffix) return `${baseName} (${suffix[1]})`;
  return assigned
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * Resolve a pack + a selection into the exact set of writes, without writing.
 * The web dialog previews this, the installer executes it, and both see the
 * same slugs — including the ones that had to move.
 *
 * @param {string} projectPath
 * @param {string} packId
 * @param {{only?: string[], names?: Record<string,string>}} [opts]
 *        `only` — template slugs to install (default: the pack's own defaults).
 *        `names` — explicit slug per template, overriding collision handling.
 */
export function planPackInstall(projectPath, packId, { only, names = {} } = {}) {
  const pack = getPack(packId);
  if (!pack) throw new Error(`pack ${packId} not found`);

  const vault = readVaultAgents();
  const roster = readAgents(projectPath);
  const taken = new Set(roster.map((a) => a.slug));

  const wanted = Array.isArray(only) && only.length
    ? new Set(only)
    : new Set((pack.agents || []).filter((a) => a.default !== false).map((a) => a.slug));

  const assigned = new Map();
  const entries = [];
  const takenNames = takenAgentNames();
  for (const agent of roster) if (agent.fields?.Name) takenNames.add(String(agent.fields.Name));
  const assignedNames = new Set();

  for (const entry of pack.agents || []) {
    const template = vault.find((a) => a.slug === entry.slug);
    const selected = wanted.has(entry.slug);
    if (!template) {
      entries.push({ template: entry.slug, selected, missing: true });
      continue;
    }
    if (!selected) {
      entries.push({ template: entry.slug, selected: false, name: template.fields?.Name || null });
      continue;
    }
    const requested = names[entry.slug];
    if (requested && !AGENT_SLUG_RE.test(requested)) throw new Error(`invalid slug "${requested}"`);
    if (requested && taken.has(requested)) throw new Error(`agent ${requested} already exists in project`);
    const slug = requested || nextFreeSlug(entry.slug, taken, entry.aliases || []);
    taken.add(slug);
    assigned.set(entry.slug, slug);
    // A template that carries a persona keeps it. One that does not — the role
    // templates, which are the sane way to ship a team — gets a name here, at
    // install, and never at render time: a dialog that shows a different name
    // each time it opens is one nobody trusts.
    const persona = template.fields?.Name || null;
    const baseName =
      persona || pickAgentName([...takenNames, ...assignedNames], { seed: entry.slug });
    assignedNames.add(baseName);
    entries.push({
      template: entry.slug,
      slug,
      selected: true,
      renamed: slug !== entry.slug,
      // A generated name is already unique, so it needs no "(2)" marker; only a
      // persona the project may already have does.
      name: persona ? displayNameFor(persona, slug, entry.slug) : baseName,
      role: template.fields?.Role || null,
      description: template.fields?.Description || null,
      area: template.fields?.Area || null,
      type: template.fields?.Type || null,
      parentTemplate: entry.parent || null,
    });
  }

  // Second pass: a Parent is a slug reference, so it can only be resolved once
  // every slug in this install is known.
  //
  // Three cases, in order. The lead was installed now → point at the slug it
  // actually got, never at the template name, which may belong to a stranger
  // that held it first. The lead was NOT selected but the project already has
  // an agent under that slug → that is the lead (this is the normal shape of
  // adding a council to a project that already has its orchestrator). Neither
  // → top level, because a Parent pointing at an agent that does not exist is
  // silent and permanent.
  const present = new Set(roster.map((a) => a.slug));
  for (const e of entries) {
    if (!e.selected || e.missing) continue;
    const lead = e.parentTemplate;
    e.parent = lead ? assigned.get(lead) || (present.has(lead) ? lead : null) : null;
    delete e.parentTemplate;
  }

  const org = readOrganization(projectPath);
  const existingAreas = new Set((org.areas || []).map((a) => a.slug));
  const areas = (pack.areas || []).map((a) => ({ ...a, created: !existingAreas.has(a.slug) }));

  return { pack: { id: pack.id, name: pack.name, description: pack.description, explain: pack.explain }, agents: entries, areas };
}

/**
 * Execute a plan: areas first (an agent's Area only resolves against areas that
 * exist), then every agent, then a role per agent so the team shows up in the
 * project's structure and not only in its agent list.
 *
 * @param {{id:number|string, path:string}|string} project  a project record or
 *        just its root — whichever the caller has; the runtime-dir helper
 *        accepts both and the CLI only ever holds the path.
 * @returns {{installed: object[], areas: string[], roles: string[]}}
 */
export function installPack(project, packId, { only, names } = {}) {
  const root = typeof project === "string" ? project : project.path;
  const plan = planPackInstall(root, packId, { only, names });
  const selected = plan.agents.filter((a) => a.selected && !a.missing);
  if (!selected.length) throw new Error("nothing selected to install");

  for (const area of plan.areas) {
    if (!area.created) continue;
    try {
      createArea(root, { slug: area.slug, name: area.name });
    } catch {
      // Raced or already there under another name — resolveAreaSlug still finds it.
    }
  }

  const vault = readVaultAgents();
  // Grows as we write, so pickBlob hands every member of the team a face this
  // project is not already using.
  const roster = readAgents(root);
  const installed = [];

  for (const entry of selected) {
    const template = vault.find((a) => a.slug === entry.template);
    const f = template.fields || {};
    const fields = buildNewAgentFields(
      root,
      {
        name: entry.name,
        role: f.Role,
        model: f.Model,
        language: f.Language,
        description: f.Description,
        skills: f.Skills,
        tools: Array.isArray(f.Tools) && f.Tools.length ? f.Tools : undefined,
        is_master: String(f.Master || "").toLowerCase() === "true",
        parent: entry.parent,
        type: f.Type,
        area: f.Area,
        emoji: f.Emoji,
        icon: f.Icon,
      },
      roster,
    );
    // Which template this came from, so a year from now it is possible to tell
    // an agent that was installed from one that somebody wrote by hand — and to
    // find every project running an old version of a template.
    fields.Template = entry.template;
    writeAgentFile(root, entry.slug, fields, template.body || "");
    ensureAgentDir(root, entry.slug);
    ensureAgentRuntimeDir(project, entry.slug);
    roster.push({ slug: entry.slug, fields });
    installed.push({ slug: entry.slug, template: entry.template, renamed: !!entry.renamed, parent: entry.parent || null });
  }

  const roles = [];
  for (const entry of selected) {
    const agent = roster.find((a) => a.slug === entry.slug);
    try {
      const role = createRole(root, {
        slug: entry.slug,
        name: entry.role || entry.name || entry.slug,
        area: agent?.fields?.Area || null,
        description: entry.description || null,
      });
      roles.push(role.slug);
    } catch {
      // A role with that slug already exists — the team is installed either way.
    }
  }

  return { installed, areas: plan.areas.filter((a) => a.created).map((a) => a.slug), roles };
}
