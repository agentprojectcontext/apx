// Display strings for the agent vault and its packs, in the reader's language.
//
// WHY A SEPARATE FILE AND NOT THE TEMPLATE. A template's `role` and
// `description` are the agent's own data: both are written into its
// frontmatter at install and both reach the model (build-agent-system puts
// `Role:` and the description in the prompt). So the template stays English —
// one source of truth for what the agent is TOLD — and the overlay answers a
// different question: what the panel SHOWS someone who is deciding whether to
// install it. Same split as a profile package (config.schema.es.json), and the
// same reason: translating the model-facing copy would silently change what the
// agent is.
//
// A pack's own name/description/explain are the exception that proves it —
// those are pure installer copy, they reach nobody but the reader, and they
// were the two English paragraphs sitting at the top of a Spanish dialog.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { AGENT_VAULT_DIR } from "#core/config/paths.js";

const __dir = path.dirname(fileURLToPath(import.meta.url));
const ASSETS = path.resolve(__dir, "../../../assets");

/** `es-AR` → ["es-AR", "es"]. A package that ships one Spanish file serves both. */
function langCandidates(lang) {
  const code = String(lang || "").trim();
  if (!code || code.toLowerCase() === "en") return [];
  const base = code.split("-")[0];
  return base && base !== code ? [code, base] : [code];
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

/**
 * The first strings file that exists for `lang`, bundled or user-supplied.
 *
 * The user layer wins, so somebody unhappy with a translation — or shipping
 * their own templates — can drop `~/.apx/agents/<base>.<lang>.json` next to
 * them rather than editing the install.
 */
function strings(base, lang) {
  for (const code of langCandidates(lang)) {
    const user = path.join(AGENT_VAULT_DIR, `${base}.${code}.json`);
    if (fs.existsSync(user)) return readJson(user);
    const bundled = path.join(ASSETS, `${base}.${code}.json`);
    if (fs.existsSync(bundled)) return readJson(bundled);
  }
  return null;
}

/**
 * A vault template's role and description as the panel should show them.
 * Returns `{ role, description }` — the originals when nothing is translated,
 * so callers can use it unconditionally.
 */
export function vaultDisplayStrings(slug, fields = {}, lang) {
  const tr = strings("agent-vault", lang)?.agents?.[slug];
  return {
    role: tr?.role || fields.Role || fields.role || null,
    description: tr?.description || fields.Description || fields.description || null,
  };
}

/** A pack with its name/description/explain in `lang`, or unchanged. */
export function localizePack(pack, lang) {
  const tr = strings("agent-vault-packs", lang)?.packs?.[pack?.id];
  if (!tr) return pack;
  return {
    ...pack,
    ...(tr.name ? { name: tr.name } : {}),
    ...(tr.description ? { description: tr.description } : {}),
    ...(tr.explain ? { explain: tr.explain } : {}),
  };
}
