// Organization structure (areas + roles) for a project.
//
// Only meaningful for "company"/enterprise-shaped projects, but the store is
// generic: any project can carry an org chart. Persisted as committed JSON at
//   <root>/.apc/organization.json
// so it travels with the project and is diffable (same model as agents). No
// secrets ever live here.
//
// Shape on disk:
//   {
//     "areas": [{ slug, name, goal }],
//     "roles": [{ slug, name, area, description }]
//   }
//
// `role.area` references an area slug (or null for a general/unassigned role).
// Deleting an area detaches its roles (sets their `area` to null) rather than
// cascading a delete — losing a role definition because its grouping changed
// would be surprising.
import fs from "node:fs";
import path from "node:path";
import { apcOrganizationFile } from "../apc/paths.js";

export const ORG_SLUG_RE = /^[a-z][a-z0-9_-]*$/;

// Derive a slug from a free-text name (kebab-case). Mirrors the front-end's
// auto-slug behavior so a name typed in either surface yields the same slug.
export function slugifyName(name) {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

function emptyOrg() {
  return { areas: [], roles: [] };
}

export function readOrganization(root) {
  const file = apcOrganizationFile(root);
  if (!fs.existsSync(file)) return emptyOrg();
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    return {
      areas: Array.isArray(raw.areas) ? raw.areas : [],
      roles: Array.isArray(raw.roles) ? raw.roles : [],
    };
  } catch {
    // A corrupt file shouldn't take down the whole project view.
    return emptyOrg();
  }
}

function writeOrganization(root, org) {
  const file = apcOrganizationFile(root);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(org, null, 2) + "\n");
  return org;
}

function normSlug(input, fallbackName) {
  const raw = input && String(input).trim() ? input : slugifyName(fallbackName);
  const slug = slugifyName(raw);
  if (!slug || !ORG_SLUG_RE.test(slug)) {
    throw new Error(`invalid slug: ${slug || "(empty)"}`);
  }
  return slug;
}

// ─────────────────────────────── Areas ─────────────────────────────────────

export function createArea(root, { name, slug, goal } = {}) {
  if (!name || !String(name).trim()) throw new Error("area name required");
  const org = readOrganization(root);
  const areaSlug = normSlug(slug, name);
  if (org.areas.some((a) => a.slug === areaSlug))
    throw new Error(`area ${areaSlug} already exists`);
  const area = { slug: areaSlug, name: String(name).trim(), goal: goal ? String(goal) : null };
  org.areas.push(area);
  writeOrganization(root, org);
  return area;
}

export function updateArea(root, slug, patch = {}) {
  const org = readOrganization(root);
  const area = org.areas.find((a) => a.slug === slug);
  if (!area) return null;
  if (patch.name !== undefined) area.name = String(patch.name).trim();
  if (patch.goal !== undefined) area.goal = patch.goal ? String(patch.goal) : null;
  writeOrganization(root, org);
  return area;
}

export function removeArea(root, slug) {
  const org = readOrganization(root);
  const idx = org.areas.findIndex((a) => a.slug === slug);
  if (idx === -1) return false;
  org.areas.splice(idx, 1);
  // Detach roles that pointed at this area (see header note).
  for (const r of org.roles) if (r.area === slug) r.area = null;
  writeOrganization(root, org);
  return true;
}

// ─────────────────────────────── Roles ─────────────────────────────────────

export function createRole(root, { name, slug, area, description } = {}) {
  if (!name || !String(name).trim()) throw new Error("role name required");
  const org = readOrganization(root);
  const roleSlug = normSlug(slug, name);
  if (org.roles.some((r) => r.slug === roleSlug))
    throw new Error(`role ${roleSlug} already exists`);
  const areaSlug = area ? String(area) : null;
  if (areaSlug && !org.areas.some((a) => a.slug === areaSlug))
    throw new Error(`area ${areaSlug} not found`);
  const role = {
    slug: roleSlug,
    name: String(name).trim(),
    area: areaSlug,
    description: description ? String(description) : null,
  };
  org.roles.push(role);
  writeOrganization(root, org);
  return role;
}

export function updateRole(root, slug, patch = {}) {
  const org = readOrganization(root);
  const role = org.roles.find((r) => r.slug === slug);
  if (!role) return null;
  if (patch.name !== undefined) role.name = String(patch.name).trim();
  if (patch.description !== undefined)
    role.description = patch.description ? String(patch.description) : null;
  if (patch.area !== undefined) {
    const areaSlug = patch.area ? String(patch.area) : null;
    if (areaSlug && !org.areas.some((a) => a.slug === areaSlug))
      throw new Error(`area ${areaSlug} not found`);
    role.area = areaSlug;
  }
  writeOrganization(root, org);
  return role;
}

export function removeRole(root, slug) {
  const org = readOrganization(root);
  const idx = org.roles.findIndex((r) => r.slug === slug);
  if (idx === -1) return false;
  org.roles.splice(idx, 1);
  writeOrganization(root, org);
  return true;
}
