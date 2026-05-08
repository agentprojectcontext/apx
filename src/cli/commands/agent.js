import { findApfRoot, readAgents, readAgentsFromDir, SLUG_RE } from "../../core/parser.js";
import { writeAgentFile, ensureAgentDir, regenerateAgentsMd } from "../../core/scaffold.js";
import { http } from "../http.js";

function requireRoot() {
  const root = findApfRoot();
  if (!root) throw new Error("not inside an APC project (run `apx init` first)");
  return root;
}

async function nudgeDaemon(root) {
  try {
    if (!(await http.ping())) return;
    const projects = await http.get("/projects", { autoStart: false });
    const me = projects.find((p) => p.path === root);
    if (me) await http.post(`/projects/${me.id}/rebuild`, undefined, { autoStart: false });
  } catch { /* daemon hiccup */ }
}

export async function cmdAgentAdd(args) {
  const slug = args._[0];
  if (!slug) throw new Error("apx agent add: missing <slug>");
  if (!SLUG_RE.test(slug)) throw new Error(`invalid slug "${slug}"`);

  const root = requireRoot();
  const existing = readAgents(root);
  if (existing.some((a) => a.slug === slug)) {
    throw new Error(`agent "${slug}" already exists`);
  }

  const fields = {};
  const f = args.flags;
  if (f.role && f.role !== true)        fields.Role = f.role;
  if (f.model && f.model !== true)      fields.Model = f.model;
  if (f.language && f.language !== true) fields.Language = f.language;
  if (f.description && f.description !== true) fields.Description = f.description;
  if (f.skills && f.skills !== true)    fields.Skills = String(f.skills).split(",").map((s) => s.trim()).filter(Boolean);
  if (f.tools && f.tools !== true)      fields.Tools = String(f.tools).split(",").map((s) => s.trim()).filter(Boolean);

  writeAgentFile(root, slug, fields);
  ensureAgentDir(root, slug);
  regenerateAgentsMd(root);
  await nudgeDaemon(root);

  console.log(`Added agent ${slug}`);
  for (const [k, v] of Object.entries(fields)) {
    console.log(`  ${k}: ${Array.isArray(v) ? v.join(", ") : v}`);
  }
}

export function cmdAgentList() {
  const root = requireRoot();
  const agents = readAgents(root);
  if (agents.length === 0) {
    console.log("(no agents defined — try `apx agent add <slug>`)");
    return;
  }
  for (const a of agents) {
    console.log(`${a.slug}\t${a.fields.Role || "—"}\t${a.fields.Model || "—"}`);
  }
}

export function cmdAgentGet(args) {
  const slug = args._[0];
  if (!slug) throw new Error("apx agent get: missing <slug>");
  const root = requireRoot();
  const a = readAgents(root).find((x) => x.slug === slug);
  if (!a) throw new Error(`agent "${slug}" not found`);
  console.log(`# ${a.slug}`);
  for (const [k, v] of Object.entries(a.fields)) {
    console.log(`  ${k}: ${Array.isArray(v) ? v.join(", ") : v}`);
  }
  if (a.body) console.log(`\n${a.body}`);
}
