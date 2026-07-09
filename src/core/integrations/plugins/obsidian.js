// Obsidian integration plugin — the "credential" is a local Vault (a directory
// of Markdown notes), not a remote API token. Unlike Asana/GitHub there is no
// provider to call: the plugin's config is a filesystem `vault_path` plus a
// couple of toggles. This same module doubles as a pure vault client that the
// agent tools (obsidian-*.js) call to read/search/write notes directly on disk
// — no external process, works offline, fully under APX's control.
//
// Two extra hooks beyond the standard lifecycle contract:
//   - mcpServer(record): the generic MCP-reconcile hook the daemon uses to
//     auto-register (opt-in) a community Obsidian MCP pointing at the vault.
//   - actions.sync_memory(record, ctx): mirrors APX memory into the vault.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// ─── path helpers ───────────────────────────────────────────────────────────

// Expand a leading `~` to the user's home dir (Obsidian users type paths by hand).
export function expandHome(p) {
  const s = String(p || "");
  if (s === "~") return os.homedir();
  if (s.startsWith("~/") || s.startsWith("~\\")) return path.join(os.homedir(), s.slice(2));
  return s;
}

// Turn a user-supplied vault path into a resolved absolute path.
export function resolveVaultPath(raw) {
  const expanded = expandHome(String(raw || "").trim());
  if (!expanded) throw new Error("Vault path is empty");
  return path.resolve(expanded);
}

// A directory is a "real" Obsidian vault when it holds a `.obsidian` config
// folder. We don't require it — a plain folder of markdown works too — but we
// report it so the UI can confirm the pick.
export function isObsidianVault(vaultPath) {
  try {
    return fs.statSync(path.join(vaultPath, ".obsidian")).isDirectory();
  } catch {
    return false;
  }
}

// Throw unless `vaultPath` points at an existing directory.
export function assertVaultDir(vaultPath) {
  let st;
  try {
    st = fs.statSync(vaultPath);
  } catch {
    throw new Error(`Vault path does not exist: ${vaultPath}`);
  }
  if (!st.isDirectory()) throw new Error(`Vault path is not a directory: ${vaultPath}`);
  return true;
}

// Normalize a user-supplied note reference to an absolute `.md` path inside the
// vault, refusing anything that escapes the vault root (path-traversal guard).
function noteAbs(vaultPath, note) {
  let rel = String(note || "").trim();
  if (!rel) throw new Error("Note path is required");
  rel = rel.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!/\.md$/i.test(rel)) rel += ".md";
  const root = path.resolve(vaultPath);
  const abs = path.resolve(root, rel);
  if (abs !== root && !abs.startsWith(root + path.sep)) {
    throw new Error(`Note path escapes the vault: ${note}`);
  }
  return abs;
}

// ─── vault client (used by the agent tools) ─────────────────────────────────

// Recursively list markdown notes as vault-relative POSIX paths. Skips dotfiles
// and dot-dirs (`.obsidian`, `.trash`, …).
export function listNotes(vaultPath, { limit = 1000 } = {}) {
  assertVaultDir(vaultPath);
  const root = path.resolve(vaultPath);
  const out = [];
  const walk = (dir) => {
    if (out.length >= limit) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (out.length >= limit) return;
      if (e.name.startsWith(".")) continue;
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) walk(abs);
      else if (/\.md$/i.test(e.name)) out.push(path.relative(root, abs).split(path.sep).join("/"));
    }
  };
  walk(root);
  out.sort();
  return out;
}

export function readNote(vaultPath, note) {
  assertVaultDir(vaultPath);
  const abs = noteAbs(vaultPath, note);
  if (!fs.existsSync(abs)) throw new Error(`Note not found: ${note}`);
  return fs.readFileSync(abs, "utf8");
}

// Create or update a note. `mode`: "overwrite" (default) | "append".
export function writeNote(vaultPath, note, content, { mode = "overwrite" } = {}) {
  assertVaultDir(vaultPath);
  const abs = noteAbs(vaultPath, note);
  const body = String(content ?? "");
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  if (mode === "append" && fs.existsSync(abs)) {
    const prev = fs.readFileSync(abs, "utf8");
    fs.writeFileSync(abs, prev + (prev.endsWith("\n") ? "" : "\n") + body);
  } else {
    fs.writeFileSync(abs, body);
  }
  const root = path.resolve(vaultPath);
  return {
    note: path.relative(root, abs).split(path.sep).join("/"),
    bytes: Buffer.byteLength(body),
    mode,
  };
}

// Dependency-free substring search across note bodies + filenames. Returns a
// short context snippet per hit.
export function searchNotes(vaultPath, query, { limit = 50, caseSensitive = false } = {}) {
  assertVaultDir(vaultPath);
  const q = String(query || "").trim();
  if (!q) throw new Error("Search query is required");
  const needle = caseSensitive ? q : q.toLowerCase();
  const notes = listNotes(vaultPath, { limit: 10000 });
  const results = [];
  for (const rel of notes) {
    if (results.length >= limit) break;
    let body;
    try {
      body = fs.readFileSync(path.join(vaultPath, rel), "utf8");
    } catch {
      continue;
    }
    const hay = caseSensitive ? body : body.toLowerCase();
    const nameHit = (caseSensitive ? rel : rel.toLowerCase()).includes(needle);
    const idx = hay.indexOf(needle);
    if (idx === -1 && !nameHit) continue;
    let snippet = "";
    if (idx !== -1) {
      const start = Math.max(0, idx - 40);
      const end = Math.min(body.length, idx + needle.length + 40);
      snippet =
        (start > 0 ? "…" : "") +
        body.slice(start, end).replace(/\s+/g, " ").trim() +
        (end < body.length ? "…" : "");
    }
    results.push({ note: rel, snippet, title_match: nameHit });
  }
  return results;
}

// ─── plugin descriptor + lifecycle ──────────────────────────────────────────

function asBool(v, fallback) {
  if (v === undefined || v === null) return fallback;
  return v === true || v === "true" || v === "on" || v === 1 || v === "1";
}

export const obsidianPlugin = {
  slug: "obsidian",
  name: "Obsidian",
  type: "knowledge",
  description:
    "Conectá un Vault de Obsidian para que los agentes lean, busquen y escriban notas",
  auth: "path",
  tools: [
    { slug: "obsidian_search_notes", desc: "Buscar notas en el Vault" },
    { slug: "obsidian_read_note", desc: "Leer una nota" },
    { slug: "obsidian_write_note", desc: "Crear o actualizar una nota" },
    { slug: "obsidian_list_notes", desc: "Listar notas del Vault" },
  ],
  // Structure only — display text lives in web i18n (integrations.obsidian.*).
  ui: {
    accent: "purple",
    configFields: [
      { key: "vault_path", type: "path", placeholder: "/Users/tu-usuario/Obsidian/MiVault" },
      { key: "auto_mcp", type: "toggle", default: false },
      { key: "memory_sync", type: "toggle", default: false },
    ],
    connectedFields: ["vault_path", "vault_name", "note_count"],
    // Buttons shown in the connected view (label from i18n).
    actions: [{ action: "sync_memory" }],
  },

  configure(record, body = {}) {
    const rawPath = String(body.vault_path ?? record?.config?.vault_path ?? "").trim();
    if (!rawPath) throw new Error("Provide the path to your Obsidian vault");
    const config = {
      vault_path: rawPath,
      auto_mcp: asBool(body.auto_mcp, record?.config?.auto_mcp ?? false),
      memory_sync: asBool(body.memory_sync, record?.config?.memory_sync ?? false),
    };
    return {
      patch: {
        name: this.name,
        type: this.type,
        description: this.description,
        status: "pending_validation",
        config,
      },
    };
  },

  async validate(record) {
    const config = record?.config || {};
    let vaultPath;
    try {
      vaultPath = resolveVaultPath(config.vault_path);
      assertVaultDir(vaultPath);
    } catch (e) {
      return {
        patch: { status: "error", is_enabled: false, config: { last_error: String(e.message || e) } },
        result: { ok: false, error: String(e.message || e) },
      };
    }
    const isVault = isObsidianVault(vaultPath);
    const noteCount = listNotes(vaultPath, { limit: 10000 }).length;
    const vaultName = path.basename(vaultPath);
    // Persist the resolved absolute path so downstream consumers (tools, MCP,
    // sync) never re-expand `~`.
    return {
      patch: {
        status: "active",
        is_enabled: true,
        config: {
          vault_path: vaultPath,
          vault_name: vaultName,
          is_vault: isVault,
          note_count: noteCount,
          last_error: null,
        },
      },
      result: { ok: true, vault_path: vaultPath, vault_name: vaultName, is_vault: isVault, note_count: noteCount },
    };
  },

  status(record) {
    const c = record?.config || {};
    return {
      slug: this.slug,
      status: record?.status || "disconnected",
      is_enabled: !!record?.is_enabled,
      vault_path: c.vault_path || null,
      vault_name: c.vault_name || null,
      note_count: c.note_count ?? null,
      is_vault: c.is_vault ?? null,
      auto_mcp: !!c.auto_mcp,
      memory_sync: !!c.memory_sync,
    };
  },

  deactivate() {
    return { patch: { status: "inactive", is_enabled: false } };
  },

  // Generic MCP-reconcile hook (see host/daemon/api/integrations.js). Returns
  // the desired `{ name, def }` for a community Obsidian MCP when the vault is
  // active AND the user opted into `auto_mcp`; otherwise `def: null` so the
  // reconcile removes any stale server. Command/args overridable via config.
  mcpServer(record) {
    const c = record?.config || {};
    const active = record?.status === "active" && !!record?.is_enabled && !!c.auto_mcp && !!c.vault_path;
    if (!active) return { name: "obsidian", def: null };
    const command = c.mcp_command || "npx";
    const args =
      Array.isArray(c.mcp_args) && c.mcp_args.length ? c.mcp_args : ["-y", "obsidian-mcp", c.vault_path];
    return { name: "obsidian", def: { command, args, enabled: true } };
  },

  actions: {
    // Quick connectivity probe (web refresh / smoke test): list a few notes.
    async notes(record) {
      const vaultPath = resolveVaultPath(record?.config?.vault_path);
      const notes = listNotes(vaultPath, { limit: 25 });
      return { notes, count: listNotes(vaultPath, { limit: 10000 }).length, sample: notes };
    },
    // Mirror APX memory into the vault. Needs project context (all projects +
    // the current one), passed as the 2nd arg by the daemon action dispatch.
    async sync_memory(record, ctx = {}) {
      const vaultPath = resolveVaultPath(record?.config?.vault_path);
      const folder = record?.config?.memory_folder || "APX";
      const { syncMemoryToVault, collectMemorySources } = await import("../obsidian-memory.js");
      const sources = collectMemorySources(ctx);
      return syncMemoryToVault({ vaultPath, folder, sources });
    },
  },
};

export default obsidianPlugin;
