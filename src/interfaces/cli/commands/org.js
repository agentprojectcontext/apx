// apx org — organization structure (areas + roles) for a project.
// Backed by /projects/:pid/organization (core/stores/organization.js).
//
//   apx org show                                   [--project X]
//   apx org area add "<name>" [--slug s] [--goal g] [--project X]
//   apx org area rm <slug>                          [--project X]
//   apx org role add "<name>" [--slug s] [--area a] [--desc d] [--project X]
//   apx org role rm <slug>                          [--project X]
//
// Thin surface over the daemon API — the web panel calls the same routes.
import { http } from "../http.js";
import { resolveProjectId } from "./project.js";

export const ORG_USAGE = {
  show:     "apx org show [--project X]",
  areaAdd:  'apx org area add "<name>" [--slug s] [--goal g] [--project X]',
  areaRm:   "apx org area rm <slug> [--project X]",
  roleAdd:  'apx org role add "<name>" [--slug s] [--area a] [--desc d] [--project X]',
  roleRm:   "apx org role rm <slug> [--project X]",
};

function fail(key, msg) {
  console.error(`apx org: ${msg}`);
  console.error(`Usage: ${ORG_USAGE[key]}`);
  process.exit(1);
}

export async function cmdOrgShow(args) {
  const pid = await resolveProjectId(args?.flags?.project);
  const org = await http.get(`/projects/${pid}/organization`);
  if (!org.areas.length && !org.roles.length) {
    console.log("(no organization structure yet)");
    return;
  }
  console.log("Areas:");
  for (const a of org.areas) console.log(`  • ${a.name} (${a.slug})${a.goal ? ` — ${a.goal}` : ""}`);
  console.log("Roles:");
  for (const r of org.roles) {
    console.log(`  • ${r.name} (${r.slug})${r.area ? ` [${r.area}]` : ""}${r.description ? ` — ${r.description}` : ""}`);
  }
}

export async function cmdOrgAreaAdd(args) {
  const name = (args._ || []).slice(1).join(" ").trim();
  if (!name) return fail("areaAdd", "name required");
  const pid = await resolveProjectId(args?.flags?.project);
  const area = await http.post(`/projects/${pid}/organization/areas`, {
    name, slug: args.flags?.slug, goal: args.flags?.goal,
  });
  console.log(`added area ${area.name} (${area.slug})`);
}

export async function cmdOrgAreaRm(args) {
  const slug = (args._ || [])[1];
  if (!slug) return fail("areaRm", "slug required");
  const pid = await resolveProjectId(args?.flags?.project);
  await http.delete(`/projects/${pid}/organization/areas/${encodeURIComponent(slug)}`);
  console.log(`removed area ${slug}`);
}

export async function cmdOrgRoleAdd(args) {
  const name = (args._ || []).slice(1).join(" ").trim();
  if (!name) return fail("roleAdd", "name required");
  const pid = await resolveProjectId(args?.flags?.project);
  const role = await http.post(`/projects/${pid}/organization/roles`, {
    name, slug: args.flags?.slug, area: args.flags?.area, description: args.flags?.desc,
  });
  console.log(`added role ${role.name} (${role.slug})${role.area ? ` in ${role.area}` : ""}`);
}

export async function cmdOrgRoleRm(args) {
  const slug = (args._ || [])[1];
  if (!slug) return fail("roleRm", "slug required");
  const pid = await resolveProjectId(args?.flags?.project);
  await http.delete(`/projects/${pid}/organization/roles/${encodeURIComponent(slug)}`);
  console.log(`removed role ${slug}`);
}
