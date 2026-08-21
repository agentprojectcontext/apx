// Filesystem layout for installable profiles.
//
// Two layers, mirroring the agent vault (core/apc/parser.js):
//   - BUNDLED → src/core/profiles/bundled/<id>/, shipped with APX, read-only.
//   - USER    → ~/.apx/profiles/<id>/, installed from a local path, plus
//               copy-on-write overrides of a bundled package.
//   - REMOVED → ~/.apx/profiles/.removed.json, tombstones for bundled ids the
//               user uninstalled (a bundled package can't be deleted).
//
// Bundled packages live under src/ rather than assets/ on purpose: package.json
// `files` ships src/, skills/ and README.md only, so anything under assets/ is
// absent from an npm install. See docs-internal/secretary/00-findings.md § A.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { APX_HOME } from "../config/paths.js";

const __profilesDir = path.dirname(fileURLToPath(import.meta.url));

/** Packages shipped with APX. Read-only on the user's machine. */
export const BUNDLED_PROFILES_DIR = path.join(__profilesDir, "bundled");

/** The user's own packages and overrides. */
export const PROFILES_DIR = path.join(APX_HOME, "profiles");

/** Tombstones — bundled ids the user removed. */
export const PROFILES_TOMBSTONE_PATH = path.join(PROFILES_DIR, ".removed.json");

export const MANIFEST_FILE = "profile.json";
export const PROMPT_FILE = "PROFILE.md";
export const CONFIG_SCHEMA_FILE = "config.schema.json";

/** Ids are slugs: lowercase, digits, dashes. Keeps them safe as path segments. */
export const PROFILE_ID_RE = /^[a-z][a-z0-9-]{0,63}$/;

export function bundledProfileDir(id) {
  return path.join(BUNDLED_PROFILES_DIR, id);
}

export function userProfileDir(id) {
  return path.join(PROFILES_DIR, id);
}

/**
 * Language-specific prompt filename: PROFILE.es.md, PROFILE.pt-BR.md, …
 * `null`/"en" means the base PROFILE.md.
 */
export function promptFileFor(lang) {
  const code = String(lang || "").trim();
  if (!code || code.toLowerCase() === "en") return PROMPT_FILE;
  return `PROFILE.${code}.md`;
}

/**
 * Language-specific settings-schema filename: config.schema.es.json, …
 * Mirrors promptFileFor. The localized file carries only display strings
 * (title/description); types, defaults and enums stay in the base schema, which
 * is the single source of truth for validation.
 */
export function schemaFileFor(lang) {
  const code = String(lang || "").trim();
  if (!code || code.toLowerCase() === "en") return CONFIG_SCHEMA_FILE;
  return `config.schema.${code}.json`;
}
