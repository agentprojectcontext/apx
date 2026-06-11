// Vault = global agent templates. Two layers:
//   - bundled defaults shipped with APX (assets/agent-vault-defaults/)
//   - user overrides + brand-new ones in ~/.apx/agents/ (copy-on-write)
//
// This module owns the *normalisation* of vault input patches: which fields
// the public surface accepts, how they get split (skills/tools = arrays),
// and how casing maps to the on-disk frontmatter convention (Title case).
// Read/write to disk lives in apc/scaffold.js + apc/parser.js — this is the
// pure transform layer so HTTP routes, CLI commands, and the super-agent
// `import_agent` tool all agree on what fields exist.

export const VAULT_PATCH_FIELDS = ["role", "model", "language", "description", "skills", "tools", "is_master"];

/**
 * Normalize a user-provided vault patch:
 *   - accept lowercase OR Title case keys
 *   - drop unknown / undefined / null fields
 *   - turn skills/tools into a string[] (accepting csv strings or arrays)
 *   - emit Title-case keys so the writer doesn't have to guess
 */
export function normalizeVaultPatch(input = {}) {
  const out = {};
  for (const k of VAULT_PATCH_FIELDS) {
    const lower = k;
    const title = k.charAt(0).toUpperCase() + k.slice(1);
    const v = input[lower] ?? input[title];
    if (v === undefined || v === null) continue;
    if (k === "skills" || k === "tools") {
      out[title] = Array.isArray(v)
        ? v.map(String).map((s) => s.trim()).filter(Boolean)
        : String(v).split(",").map((s) => s.trim()).filter(Boolean);
    } else {
      out[title] = v;
    }
  }
  return out;
}
