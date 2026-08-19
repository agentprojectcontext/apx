import fs from "node:fs";
import { findApfRoot, readAgents, readVaultAgents, readVaultAgent, vaultAgentFile, VAULT_DIR, SLUG_RE } from "#core/apc/parser.js";
import { apcAgentFile } from "#core/apc/paths.js";
import { writeAgentFile, writeVaultAgentFile, removeVaultAgent, restoreVaultAgent, addImportedAgent, ensureAgentDir } from "#core/apc/scaffold.js";
import { ensureAgentRuntimeDir, agentMemoryPath } from "#core/agent/memory.js";
import {
  AGENT_TYPE_VALUES, BLOB_KEYS, isBlobKey, normalizeAgentType, pickBlob,
} from "#core/apc/agent-identity.js";
import { readOrganization, resolveAreaSlug } from "#core/stores/organization.js";
import { http } from "../http.js";
import { readStdinSync } from "../stdin.js";
import { resolveProjectId } from "./project.js";

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

function flagValue(flags, ...names) {
  for (const n of names) {
    const v = flags?.[n];
    if (v !== undefined && v !== true && v !== "") return String(v);
  }
  return null;
}

/**
 * The agent's system prompt — everything after the frontmatter in
 * `.apc/agents/<slug>.md`, injected by buildAgentSystem() as
 * "# Custom instructions".
 *
 * WHY THIS EXISTS. `apx agent add` used to write frontmatter only: there was no
 * flag for the body and `writeAgentFile`'s 4th argument was never passed. The
 * command exited 0, so an agent created from the CLI (or by the super-agent,
 * which follows the apx-agent skill) silently ran on three metadata fields with
 * no instructions at all — while the daemon API and the web UI have always been
 * able to write it via `system`. This closes that gap.
 *
 * Three ways in, because a system prompt is many lines and paragraphs:
 *   --prompt "text"        inline, for one-liners
 *   --prompt-file <path>   read from a file
 *   --prompt -             read from stdin (heredoc / pipe) — the practical one
 */
function readPromptFlag(flags) {
  const file = flagValue(flags, "prompt-file", "system-file");
  if (file) {
    if (!fs.existsSync(file)) throw new Error(`--prompt-file: no such file "${file}"`);
    return fs.readFileSync(file, "utf8").trim();
  }
  const inline = flagValue(flags, "prompt", "system");
  if (inline === "-") return readStdinSync().trim();
  if (inline) return inline;
  return null;
}

function readTypeFlag(flags) {
  const raw = flagValue(flags, "type");
  if (!raw) return null;
  const type = normalizeAgentType(raw);
  if (!type) {
    throw new Error(`invalid --type "${raw}" — one of: ${AGENT_TYPE_VALUES.join(", ")}`);
  }
  return type;
}

/**
 * The agent's avatar: a blob preset key. `--icon <key>` pins one, otherwise one
 * is drawn from the presets this project isn't using yet — an agent with no
 * `Icon` renders as a grey lettered disc in every surface, which is what every
 * CLI- and MCP-created agent used to get.
 */
function resolveIconFlag(flags, roster) {
  const raw = flagValue(flags, "icon", "avatar", "blob");
  if (raw) {
    if (!isBlobKey(raw)) {
      throw new Error(`invalid --icon "${raw}" — one of: ${BLOB_KEYS.join(", ")}`);
    }
    return raw;
  }
  return pickBlob({ taken: roster.map((a) => a.fields?.Icon).filter(Boolean) });
}

async function nudgeDaemon(root) {
  try {
    if (!(await http.ping())) return;
    const projects = await http.get("/api/projects", { autoStart: false });
    const me = projects.find((p) => p.path === root);
    if (me) await http.post(`/api/projects/${me.id}/rebuild`, undefined, { autoStart: false });
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
  if (f.area && f.area !== true) {
    const area = resolveAreaSlug(String(f.area), readOrganization(root));
    if (area) fields.Area = area;
  }
  if (f.parent && f.parent !== true)    fields.Parent = String(f.parent);
  if (f.skills && f.skills !== true)    fields.Skills = String(f.skills).split(",").map((s) => s.trim()).filter(Boolean);

  const type = readTypeFlag(f);
  if (type) {
    fields.Type = type;
    // An orchestrator is a master; the daemon and the web already tie the two
    // together on create, so the CLI can't be the one that disagrees.
    if (type === "orchestrator") fields.Master = true;
  }
  // Every agent gets a face, same as the daemon API does. Drawn from the blobs
  // this project isn't using yet so the team stays distinguishable.
  fields.Icon = resolveIconFlag(f, existing);
  // Omitted tools ⇒ leave the field UNDECLARED, matching the daemon API. A
  // declared list is a deliberate narrowing that wins forever; writing one on
  // create froze the agent to a snapshot of the catalog instead of letting it
  // inherit the broad default.
  if (f.tools && f.tools !== true) {
    fields.Tools = String(f.tools).split(",").map((s) => s.trim()).filter(Boolean);
  }

  const prompt = readPromptFlag(f);

  writeAgentFile(root, slug, fields, prompt || "");
  ensureAgentDir(root, slug);
  ensureAgentRuntimeDir(root, slug);
  await nudgeDaemon(root);

  console.log(`Added agent ${slug}`);
  for (const [k, v] of Object.entries(fields)) {
    console.log(`  ${k}: ${Array.isArray(v) ? v.join(", ") : v}`);
  }
  // Say it out loud either way. A prompt-less agent runs on its frontmatter
  // alone, which is almost never what the author meant — and the old silence
  // is exactly why that went unnoticed.
  if (prompt) {
    console.log(`  Prompt: ${Buffer.byteLength(prompt)} bytes`);
  } else {
    console.log(
      `\n  ${tag("no system prompt")} — this agent has metadata but no instructions.` +
      `\n  Add one with: apx agent set ${slug} --prompt - <<'EOF' … EOF`
    );
  }
}

// Edit an existing agent: merge frontmatter fields and/or replace the system
// prompt. The CLI had no edit path at all, so an agent created without a prompt
// could never get one without hand-editing the file (which the skill forbids,
// since AGENTS.md has to be regenerated).
export async function cmdAgentSet(args) {
  const slug = args._[0];
  if (!slug) throw new Error("apx agent set: missing <slug>");

  const root = requireRoot();
  const existing = readAgents(root).find((a) => a.slug === slug);
  if (!existing) {
    throw new Error(`agent "${slug}" not found — run \`apx agent list\` to see this project's agents`);
  }
  if (existing.source !== "local") {
    throw new Error(
      `agent "${slug}" comes from the ${existing.source} layer — run \`apx agent import ${slug} --copy\` first to get a local copy to edit`
    );
  }

  const fields = { ...(existing.fields || {}) };
  const f = args.flags;
  const set = (key, flag) => {
    const v = flagValue(f, flag);
    if (v === null) return false;
    fields[key] = v;
    return true;
  };
  let touched = false;
  for (const [key, flag] of [
    ["Role", "role"], ["Model", "model"], ["Language", "language"],
    ["Description", "description"], ["Emoji", "emoji"],
    ["Parent", "parent"],
  ]) {
    if (set(key, flag)) touched = true;
  }
  for (const [key, flag] of [["Skills", "skills"], ["Tools", "tools"]]) {
    const v = flagValue(f, flag);
    if (v === null) continue;
    fields[key] = v.split(",").map((s) => s.trim()).filter(Boolean);
    touched = true;
  }
  const type = readTypeFlag(f);
  if (type) {
    fields.Type = type;
    if (type === "orchestrator") fields.Master = true;
    touched = true;
  }
  const icon = flagValue(f, "icon", "avatar", "blob");
  if (icon) {
    if (!isBlobKey(icon)) throw new Error(`invalid --icon "${icon}" — one of: ${BLOB_KEYS.join(", ")}`);
    fields.Icon = icon;
    touched = true;
  }
  const areaRaw = flagValue(f, "area");
  if (areaRaw !== null) {
    const area = resolveAreaSlug(areaRaw, readOrganization(root));
    if (area) fields.Area = area;
    else delete fields.Area;
    touched = true;
  }

  const prompt = readPromptFlag(f);
  if (prompt === null && !touched) {
    throw new Error(
      "apx agent set: nothing to change — pass --prompt/--prompt-file or a field flag (--role, --model, --description, …)"
    );
  }

  // A field-only edit must not wipe the prompt the agent already had.
  const body = prompt === null ? (existing.body || "") : prompt;
  writeAgentFile(root, slug, fields, body);
  ensureAgentDir(root, slug);
  ensureAgentRuntimeDir(root, slug);
  await nudgeDaemon(root);

  console.log(`Updated agent ${slug}`);
  for (const [k, v] of Object.entries(fields)) {
    console.log(`  ${k}: ${Array.isArray(v) ? v.join(", ") : v}`);
  }
  if (prompt !== null) console.log(`  Prompt: ${Buffer.byteLength(body)} bytes`);
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

export async function cmdAgentRemove(args) {
  const slug = args._[0];
  if (!slug) throw new Error("apx agent remove: missing <slug> — usage: apx agent remove <slug>");
  // Resolve locally first so we can give a clear message + suggestions instead
  // of a bare 404 when the slug is wrong.
  const root = findApfRoot();
  if (root) {
    const local = readAgents(root).find((a) => a.slug === slug);
    if (!local) {
      const inVault = readVaultAgents().find((v) => v.slug === slug);
      if (inVault) throw new Error(`agent "${slug}" is in the vault but not in this project — nothing to remove here (use \`apx agent vault rm ${slug}\` to delete the template)`);
      throw new Error(`agent "${slug}" not found in this project — run \`apx agent list\` to see the agents you can remove`);
    }
  }
  const pid = await resolveProjectId(args?.flags?.project);
  await http.delete(`/api/projects/${pid}/agents/${slug}`);
  console.log(`${tag("removed")}  ${bold(slug)}  ${gray("(agent file + runtime memory deleted)")}`);
}

// ── Vault commands ────────────────────────────────────────────────────────────

export function cmdAgentVaultList(args = { flags: {} }) {
  const includeRemoved = !!args.flags.all || !!args.flags["include-removed"];
  const vault = readVaultAgents({ includeRemoved });
  if (vault.length === 0) {
    console.log(dim(`(vault empty — bundled defaults missing? add one with \`apx agent vault add <slug>\`)`));
    console.log(gray(`  vault: ${VAULT_DIR}`));
    return;
  }
  console.log(`\n  ${gray("vault:")} ${gray(VAULT_DIR)}\n`);
  for (const a of vault) {
    const role  = a.fields.Role  ? dim(a.fields.Role)  : gray("—");
    const model = a.fields.Model ? dim(a.fields.Model) : gray("—");
    const tag   = a.source === "bundled"        ? gray("[bundled]")
                : a.source === "user-override" ? tag2("[override]")
                : a.source === "user"          ? tag2("[user]")
                : "";
    console.log(`  ${bold(a.slug)}  ${role}  ${cyan(model)}  ${tag}`);
  }
  console.log();
}
// Local helper just for the list table coloring above.
function tag2(s) { return `${c.green}${s}${c.reset}`; }

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

// Remove a vault template. If the slug exists in the bundle a tombstone is
// written so it stays hidden until `apx agent vault restore <slug>`. User-
// layer files are physically removed.
export function cmdAgentVaultRm(args) {
  const slug = args._[0];
  if (!slug || !SLUG_RE.test(slug)) throw new Error("apx agent vault rm: missing or invalid <slug>");
  const before = readVaultAgent(slug, { includeRemoved: true });
  if (!before) throw new Error(`"${slug}" not found in vault (bundled or user)`);
  const out = removeVaultAgent(slug);
  if (out.removed === "tomb") {
    console.log(`  ${tag("hidden")}  ${bold(slug)}  ${gray("(bundled default tombstoned — restore with `apx agent vault restore`)")}`);
  } else if (out.removed === "user") {
    console.log(`  ${tag("removed")}  ${bold(slug)}  ${gray("(user template deleted; no bundled default exists)")}`);
  } else if (out.removed === "user+tomb") {
    console.log(`  ${tag("removed")}  ${bold(slug)}  ${gray("(user override deleted + bundled tombstoned)")}`);
  }
}

// Un-tombstone a bundled slug. No-op if it wasn't hidden.
export function cmdAgentVaultRestore(args) {
  const slug = args._[0];
  if (!slug || !SLUG_RE.test(slug)) throw new Error("apx agent vault restore: missing or invalid <slug>");
  const out = restoreVaultAgent(slug);
  if (!out.restored) {
    console.log(dim(`  (slug "${slug}" was not tombstoned — nothing to restore)`));
    return;
  }
  console.log(`  ${cyan("restored")}  ${bold(slug)}  ${gray("(bundled default visible again)")}`);
}

export async function cmdAgentImport(args) {
  const slug = args._[0];
  if (!slug) throw new Error("apx agent import: missing <slug>");
  const root = requireRoot();

  // Layered lookup (user file → bundled default) — see vaultAgentFile. Reading
  // the user layer alone made every bundled agent unimportable.
  const vaultPath = vaultAgentFile(slug);
  if (!vaultPath) {
    const vault = readVaultAgents();
    const available = vault.map((a) => a.slug).join(", ") || "(none)";
    throw new Error(`"${slug}" not found in vault. Available: ${available}`);
  }

  const alreadyLocal = fs.existsSync(apcAgentFile(root, slug));
  if (alreadyLocal && !args.flags.force) {
    console.log(dim(`  "${slug}" already has a local definition. Use --force to overwrite.`));
    return;
  }

  if (args.flags.copy) {
    // Copy .md into project so user can edit locally
    fs.copyFileSync(vaultPath, apcAgentFile(root, slug));
    console.log(`\n  ${bold(slug)} copied from vault to project (now local)\n`);
  } else {
    // Just register as imported — reads from vault at runtime
    addImportedAgent(root, slug);
    console.log(`\n  ${bold(slug)} imported from vault ${tag("↑ vault")}\n`);
    console.log(gray(`  definition: ${vaultPath}`));
    console.log(gray(`  memory:     ${agentMemoryPath(root, slug)} (runtime-local)`));
    console.log();
  }

  ensureAgentDir(root, slug);
  ensureAgentRuntimeDir(root, slug);
  await nudgeDaemon(root);
}
