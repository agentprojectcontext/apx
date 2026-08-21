// Profile package resolution — the layered read.
//
// This mirrors readVaultAgents() in core/apc/parser.js: bundled and user
// packages are resolved at READ time, user wins per id, tombstones hide bundled
// ids the user removed. Nothing is copied at install time.
//
// That distinction matters. If installing a bundled profile copied it into
// ~/.apx/profiles/, the user would be frozen at that version forever — a later
// `npm update` would ship an improved PROFILE.md that their copy shadows. So a
// user-layer directory exists only when the user genuinely owns that package:
// they installed it from a local path, or they explicitly ejected a bundled one
// to edit it.
//
// The user's *settings* are not part of the package. They live in
// ~/.apx/config.json under `profile.config`, so they survive package updates,
// `off` → `use` round-trips, and uninstall/reinstall.
import fs from "node:fs";
import path from "node:path";

import {
  BUNDLED_PROFILES_DIR,
  PROFILES_DIR,
  PROFILES_TOMBSTONE_PATH,
  MANIFEST_FILE,
  CONFIG_SCHEMA_FILE,
  PROFILE_ID_RE,
  bundledProfileDir,
  userProfileDir,
  promptFileFor,
  schemaFileFor,
} from "./paths.js";
import { schemaDefaults } from "./manifest.js";
import { readJson } from "#core/util/json-file.js";



function readDirIds(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && PROFILE_ID_RE.test(e.name))
    .map((e) => e.name)
    .sort();
}

// --------------------- tombstones -------------------------------------------

export function readProfileTombstones() {
  const raw = readJson(PROFILES_TOMBSTONE_PATH);
  return new Set(Array.isArray(raw?.ids) ? raw.ids : []);
}

export function writeProfileTombstones(ids) {
  fs.mkdirSync(PROFILES_DIR, { recursive: true });
  fs.writeFileSync(
    PROFILES_TOMBSTONE_PATH,
    JSON.stringify({ ids: [...ids].sort() }, null, 2) + "\n"
  );
}

// --------------------- resolution -------------------------------------------

/**
 * Where a profile's files actually come from, honouring the layering.
 * @returns {{ dir: string, source: "user"|"user-override"|"bundled" }|null}
 */
export function resolveProfileDir(id) {
  if (!PROFILE_ID_RE.test(String(id || ""))) return null;

  const user = userProfileDir(id);
  const bundled = bundledProfileDir(id);
  const hasUser = fs.existsSync(path.join(user, MANIFEST_FILE));
  const hasBundled = fs.existsSync(path.join(bundled, MANIFEST_FILE));

  if (hasUser) return { dir: user, source: hasBundled ? "user-override" : "user" };
  if (hasBundled) return { dir: bundled, source: "bundled" };
  return null;
}

/**
 * Load one profile package.
 * @returns {{
 *   id, dir, source, manifest, schema, defaults, prompts: string[]
 * }|null}
 */
export function readProfile(id) {
  const resolved = resolveProfileDir(id);
  if (!resolved) return null;

  const manifest = readJson(path.join(resolved.dir, MANIFEST_FILE));
  if (!manifest) return null;

  const schema = readJson(path.join(resolved.dir, CONFIG_SCHEMA_FILE));
  const prompts = fs.existsSync(resolved.dir)
    ? fs.readdirSync(resolved.dir).filter((f) => /^PROFILE(\.[\w-]+)?\.md$/.test(f)).sort()
    : [];

  return {
    id,
    dir: resolved.dir,
    source: resolved.source,
    manifest: { ...manifest, id: manifest.id || id },
    schema,
    defaults: schemaDefaults(schema),
    prompts,
  };
}

/**
 * Every profile visible to the user: bundled ∪ user, user wins, tombstones
 * filtered out.
 */
export function listProfiles({ includeRemoved = false } = {}) {
  const tombstones = readProfileTombstones();
  const ids = new Set([...readDirIds(BUNDLED_PROFILES_DIR), ...readDirIds(PROFILES_DIR)]);

  const out = [];
  for (const id of [...ids].sort()) {
    if (!includeRemoved && tombstones.has(id)) continue;
    const profile = readProfile(id);
    if (profile) out.push({ ...profile, removed: tombstones.has(id) });
  }
  return out;
}

/**
 * The base settings schema with title/description overlaid from a
 * config.schema.<lang>.json when one exists for `lang`. Only display strings
 * are localized — every property's type, default and enum come from the base
 * schema, so validation has exactly one source of truth and a missing or stale
 * translation degrades to English rather than dropping a field.
 *
 * Returns the schema unchanged when there is no localized file or `lang` is
 * English, so callers can use it unconditionally.
 */
export function localizeProfileSchema(profileDir, schema, lang) {
  if (!schema?.properties) return schema || null;

  const candidates = [];
  const wanted = schemaFileFor(lang);
  if (wanted !== CONFIG_SCHEMA_FILE) candidates.push(wanted);
  const base = String(lang || "").split("-")[0];
  if (base && base !== lang) {
    const b = schemaFileFor(base);
    if (b !== CONFIG_SCHEMA_FILE) candidates.push(b);
  }

  let strings = null;
  for (const name of candidates) {
    const file = path.join(profileDir, name);
    if (fs.existsSync(file)) {
      strings = readJson(file);
      break;
    }
  }
  if (!strings?.properties) return schema;

  const out = { ...schema, properties: {} };
  for (const [key, def] of Object.entries(schema.properties)) {
    const tr = strings.properties[key];
    out.properties[key] = tr
      ? {
          ...def,
          ...(tr.title ? { title: tr.title } : {}),
          ...(tr.description ? { description: tr.description } : {}),
        }
      : def;
  }
  return out;
}

/**
 * Resolve the prompt file for a language, falling back to the base PROFILE.md.
 * Returns the file path, or null when the package has no prompt at all.
 */
export function resolvePromptFile(profileDir, lang) {
  const candidates = [promptFileFor(lang)];

  // "pt-BR" → also try "pt" before giving up on the base file.
  const base = String(lang || "").split("-")[0];
  if (base && base !== lang) candidates.push(promptFileFor(base));
  candidates.push(promptFileFor("en"));

  for (const name of candidates) {
    const file = path.join(profileDir, name);
    if (fs.existsSync(file)) return file;
  }
  return null;
}

// --------------------- active profile state ---------------------------------

/**
 * The activation record from global config. Shape:
 *   { active: string|null, config: object, installed_at: string, version: string }
 *
 * A missing key, or `active: null`, means vanilla — and vanilla is the default
 * of a clean install.
 */
export function readProfileState(globalConfig) {
  const p = globalConfig?.profile;
  if (!p || typeof p !== "object") return { active: null, config: {} };
  return {
    active: p.active || null,
    config: p.config && typeof p.config === "object" ? p.config : {},
    installed_at: p.installed_at || null,
    version: p.version || null,
  };
}

/** The profile package that is currently active, or null. */
export function readActiveProfile(globalConfig) {
  const { active } = readProfileState(globalConfig);
  if (!active) return null;
  return readProfile(active);
}

/**
 * Effective settings for a profile: schema defaults with the user's saved
 * values layered on top. Callers render prompts from this, never from the raw
 * saved config — a package that gains a new setting must not leave a hole.
 */
export function effectiveProfileConfig(profile, globalConfig) {
  const saved = readProfileState(globalConfig).config || {};
  return { ...(profile?.defaults || {}), ...saved };
}
