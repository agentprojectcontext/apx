// `apx obsidian` — configure and drive the Obsidian integration from the CLI.
// Thin client over the generic integrations daemon API (the same routes the web
// panel uses), so scoping stays consistent: `--global` (or `--scope global`)
// targets the default space; otherwise the current/`--project` project. A vault
// is a local directory of Markdown notes; connecting it lets APX agents read,
// search and write notes, optionally auto-registers an Obsidian MCP, and lets
// you mirror APX memory into the vault.
import { http } from "../http.js";
import { resolveProjectId } from "./project.js";

const SLUG = "obsidian";

function resolveScope(flags = {}) {
  if (flags.global) return "global";
  const s = flags.scope ? String(flags.scope).toLowerCase() : "project";
  if (s === "default") return "global";
  if (s !== "project" && s !== "global") {
    throw new Error(`unknown --scope "${flags.scope}" (use project|global)`);
  }
  return s;
}

function scopeQuery(scope) {
  return `?scope=${encodeURIComponent(scope)}`;
}

export async function cmdObsidianSet(args) {
  const vaultPath = args._[0];
  if (!vaultPath) throw new Error("apx obsidian set: missing <vault-path>");
  const scope = resolveScope(args.flags);
  const pid = await resolveProjectId(args?.flags?.project);
  const body = { vault_path: vaultPath };
  if (args.flags.mcp) body.auto_mcp = true;
  if (args.flags.memory || args.flags["memory-sync"]) body.memory_sync = true;

  const q = scopeQuery(scope);
  await http.post(`/projects/${pid}/integrations/${SLUG}/configure${q}`, body);
  try {
    const r = await http.post(`/projects/${pid}/integrations/${SLUG}/validate${q}`, {});
    const badge = r.is_vault ? "Obsidian vault" : "folder (no .obsidian)";
    console.log(`✓ Obsidian connected (${scope}) — ${r.vault_name} · ${r.note_count} notes · ${badge}`);
    console.log(`  ${r.vault_path}`);
    if (body.auto_mcp) console.log("  auto-MCP: on — an 'obsidian' MCP server was registered for this scope");
    if (body.memory_sync) console.log("  memory-sync: on — run `apx obsidian sync` to mirror APX memory into the vault");
  } catch (e) {
    throw new Error(`Vault path saved but validation failed: ${e.message}`);
  }
}

export async function cmdObsidianStatus(args) {
  const scope = resolveScope(args.flags);
  const pid = await resolveProjectId(args?.flags?.project);
  const s = await http.get(`/projects/${pid}/integrations/${SLUG}${scopeQuery(scope)}`);
  if (!s || s.status === "disconnected") {
    console.log(`(Obsidian not configured in scope "${scope}")`);
    return;
  }
  console.log(`Obsidian — ${s.status}${s.is_enabled ? " (enabled)" : ""}`);
  if (s.vault_path) console.log(`  vault: ${s.vault_path}`);
  if (s.vault_name) console.log(`  name:  ${s.vault_name}`);
  if (s.note_count != null) console.log(`  notes: ${s.note_count}`);
  console.log(`  auto-MCP:    ${s.auto_mcp ? "on" : "off"}`);
  console.log(`  memory-sync: ${s.memory_sync ? "on" : "off"}`);
}

export async function cmdObsidianSync(args) {
  const scope = resolveScope(args.flags);
  const pid = await resolveProjectId(args?.flags?.project);
  const r = await http.post(`/projects/${pid}/integrations/${SLUG}/action/sync_memory${scopeQuery(scope)}`, {});
  console.log(`✓ Synced ${r.count} memory file(s) → vault folder "${r.folder}" (${r.changed} changed)`);
  for (const n of r.notes || []) console.log(`  ${n.changed ? "↑" : "="} ${n.note}`);
}

export async function cmdObsidianRemove(args) {
  const scope = resolveScope(args.flags);
  const pid = await resolveProjectId(args?.flags?.project);
  await http.delete(`/projects/${pid}/integrations/${SLUG}${scopeQuery(scope)}`);
  console.log(`Removed Obsidian integration (scope: ${scope})`);
}
