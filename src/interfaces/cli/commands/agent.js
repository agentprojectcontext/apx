import fs from "node:fs";
import path from "node:path";
import { findApfRoot, readAgents, readVaultAgents, VAULT_DIR, SLUG_RE } from "../../../core/parser.js";
import { writeAgentFile, writeVaultAgentFile, addImportedAgent, ensureAgentDir, regenerateAgentsMd } from "../../../core/scaffold.js";
import { http } from "../http.js";

// ── ANSI ──────────────────────────────────────────────────────────────────────
const c = { reset:"\x1b[0m", bold:"\x1b[1m", dim:"\x1b[2m", cyan:"\x1b[36m", green:"\x1b[32m", yellow:"\x1b[33m", gray:"\x1b[90m" };
const dim  = (s) => `${c.dim}${s}${c.reset}`;
const bold = (s) => `${c.bold}${s}${c.reset}`;
const cyan = (s) => `${c.cyan}${s}${c.reset}`;
const gray = (s) => `${c.gray}${s}${c.reset}`;
const tag  = (s) => `${c.yellow}${s}${c.reset}`;

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
    console.log(dim("(no agents — try `apx agent add <slug>` or `apx agent import <slug>`)"));
    return;
  }
  console.log();
  for (const a of agents) {
    const src   = a.source === "vault" ? tag(" ↑ vault") : a.source === "legacy" ? gray(" ↑ legacy") : "";
    const role  = a.fields.Role  ? dim(a.fields.Role)  : gray("—");
    const model = a.fields.Model ? dim(a.fields.Model) : gray("—");
    console.log(`  ${bold(a.slug)}${src}  ${role}  ${cyan(model)}`);
  }
  console.log();
}

export function cmdAgentGet(args) {
  const slug = args._[0];
  if (!slug) throw new Error("apx agent get: missing <slug>");
  const root = requireRoot();
  const a = readAgents(root).find((x) => x.slug === slug);
  if (!a) {
    // Check vault and suggest import
    const vault = readVaultAgents();
    const inVault = vault.find((v) => v.slug === slug);
    if (inVault) {
      throw new Error(`agent "${slug}" not imported in this project. Run: apx agent import ${slug}`);
    }
    throw new Error(`agent "${slug}" not found`);
  }
  const src = a.source === "vault" ? tag(" ↑ vault") : a.source === "legacy" ? gray(" ↑ legacy") : "";
  console.log(`\n  ${bold(a.slug)}${src}`);
  for (const [k, v] of Object.entries(a.fields)) {
    console.log(`  ${gray(k.padEnd(12))}  ${Array.isArray(v) ? v.join(", ") : v}`);
  }
  if (a.body) console.log(`\n${dim(a.body)}`);
  console.log();
}

// ── Vault commands ────────────────────────────────────────────────────────────

export function cmdAgentVaultList() {
  const vault = readVaultAgents();
  if (vault.length === 0) {
    console.log(dim(`(vault empty — add templates with \`apx agent vault add <slug>\`)`));
    console.log(gray(`  vault: ${VAULT_DIR}`));
    return;
  }
  console.log(`\n  ${gray("vault:")} ${gray(VAULT_DIR)}\n`);
  for (const a of vault) {
    const role  = a.fields.Role  ? dim(a.fields.Role)  : gray("—");
    const model = a.fields.Model ? dim(a.fields.Model) : gray("—");
    console.log(`  ${bold(a.slug)}  ${role}  ${cyan(model)}`);
  }
  console.log();
}

export async function cmdAgentVaultAdd(args) {
  const slug = args._[0];
  if (!slug || !SLUG_RE.test(slug)) throw new Error("apx agent vault add: missing or invalid <slug>");

  // If we're inside a project, offer to copy the local agent to vault
  const root = findApfRoot();
  if (root) {
    const local = readAgents(root).find((a) => a.slug === slug && a.source === "local");
    if (local) {
      writeVaultAgentFile(slug, local.fields, local.body);
      console.log(`\n  ${bold(slug)} added to vault from local definition\n`);
      return;
    }
  }

  // Otherwise create a blank vault entry from flags
  const fields = {};
  const f = args.flags;
  if (f.role && f.role !== true)        fields.Role = f.role;
  if (f.model && f.model !== true)      fields.Model = f.model;
  if (f.language && f.language !== true) fields.Language = f.language;
  if (f.description && f.description !== true) fields.Description = f.description;
  if (f.skills && f.skills !== true)    fields.Skills = String(f.skills).split(",").map((s) => s.trim()).filter(Boolean);

  writeVaultAgentFile(slug, fields);
  console.log(`\n  ${bold(slug)} added to vault  ${gray(VAULT_DIR + "/" + slug + ".md")}\n`);
}

export async function cmdAgentImport(args) {
  const slug = args._[0];
  if (!slug) throw new Error("apx agent import: missing <slug>");
  const root = requireRoot();

  const vaultPath = path.join(VAULT_DIR, `${slug}.md`);
  if (!fs.existsSync(vaultPath)) {
    const vault = readVaultAgents();
    const available = vault.map((a) => a.slug).join(", ") || "(none)";
    throw new Error(`"${slug}" not found in vault. Available: ${available}`);
  }

  const alreadyLocal = fs.existsSync(path.join(root, ".apc", "agents", `${slug}.md`));
  if (alreadyLocal && !args.flags.force) {
    console.log(dim(`  "${slug}" already has a local definition. Use --force to overwrite.`));
    return;
  }

  if (args.flags.copy) {
    // Copy .md into project so user can edit locally
    fs.copyFileSync(vaultPath, path.join(root, ".apc", "agents", `${slug}.md`));
    console.log(`\n  ${bold(slug)} copied from vault to project (now local)\n`);
  } else {
    // Just register as imported — reads from vault at runtime
    addImportedAgent(root, slug);
    console.log(`\n  ${bold(slug)} imported from vault ${tag("↑ vault")}\n`);
    console.log(gray(`  definition: ${vaultPath}`));
    console.log(gray(`  memory:     ${path.join(root, ".apc", "agents", slug, "memory.md")} (project-local)`));
    console.log();
  }

  ensureAgentDir(root, slug);
  regenerateAgentsMd(root);
  await nudgeDaemon(root);
}
