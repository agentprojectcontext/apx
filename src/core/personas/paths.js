// Filesystem layout for installable personas.
//
// Two layers, mirroring the agent vault (core/apc/parser.js):
//   - BUNDLED → src/core/personas/bundled/<id>/, shipped with APX, read-only.
//   - USER    → ~/.apx/personas/<id>/, installed from a local path, plus
//               copy-on-write overrides of a bundled package.
//   - REMOVED → ~/.apx/personas/.removed.json, tombstones for bundled ids the
//               user uninstalled (a bundled package can't be deleted).
//
// Bundled packages live under src/ rather than assets/ on purpose: package.json
// `files` ships src/, skills/ and README.md only, so anything under assets/ is
// absent from an npm install. See docs-internal/secretary/00-findings.md § A.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { APX_HOME } from "../config/paths.js";

const __personasDir = path.dirname(fileURLToPath(import.meta.url));

/** Packages shipped with APX. Read-only on the user's machine. */
export const BUNDLED_PERSONAS_DIR = path.join(__personasDir, "bundled");

/** The user's own packages and overrides. */
export const PERSONAS_DIR = path.join(APX_HOME, "personas");

/** Tombstones — bundled ids the user removed. */
export const PERSONAS_TOMBSTONE_PATH = path.join(PERSONAS_DIR, ".removed.json");

export const MANIFEST_FILE = "persona.json";
export const PROMPT_FILE = "PERSONA.md";
export const CONFIG_SCHEMA_FILE = "config.schema.json";

/** Ids are slugs: lowercase, digits, dashes. Keeps them safe as path segments. */
export const PERSONA_ID_RE = /^[a-z][a-z0-9-]{0,63}$/;

export function bundledPersonaDir(id) {
  return path.join(BUNDLED_PERSONAS_DIR, id);
}

export function userPersonaDir(id) {
  return path.join(PERSONAS_DIR, id);
}

/**
 * Language-specific prompt filename: PERSONA.es.md, PERSONA.pt-BR.md, …
 * `null`/"en" means the base PERSONA.md.
 */
export function promptFileFor(lang) {
  const code = String(lang || "").trim();
  if (!code || code.toLowerCase() === "en") return PROMPT_FILE;
  return `PERSONA.${code}.md`;
}
