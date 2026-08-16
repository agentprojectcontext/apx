// Persona lifecycle: install / use / off / config / doctor / uninstall.
//
// Install and activate are separate operations on purpose — installing puts a
// package within reach and validates it; `use` is the moment the super-agent's
// behaviour actually changes.
//
// Nothing here touches user data. Turning a persona off disables the routines
// it installed but deletes nothing, so `off` → `use` is a round-trip that keeps
// settings, tasks and memory intact.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

import { readConfig, writeConfig } from "../config/index.js";
import { projectStorageRoot, DEFAULT_PROJECT_ID } from "../config/paths.js";
import { readIdentity } from "../identity/index.js";
import { renderPromptTemplate } from "../agent/render-template.js";
import {
  listRoutines,
  upsertRoutine,
  setEnabled,
  deleteRoutine,
} from "../stores/routines.js";

import {
  PERSONAS_DIR,
  MANIFEST_FILE,
  CONFIG_SCHEMA_FILE,
  PERSONA_ID_RE,
  userPersonaDir,
} from "./paths.js";
import {
  validateManifest,
  validateConfigSchema,
  validateConfigValues,
  schemaDefaults,
} from "./manifest.js";
import {
  readPersona,
  listPersonas,
  readPersonaState,
  readActivePersona,
  effectivePersonaConfig,
  readPersonaTombstones,
  writePersonaTombstones,
  resolvePromptFile,
} from "./store.js";
import { renderPersonaPrompt, clearPersonaBlockCache } from "./block.js";

/** Rough token estimate. Same 4-chars-per-token rule scripts/ uses. */
export function estimateTokens(text) {
  return Math.round(String(text || "").length / 4);
}

/**
 * Fingerprint of a routine's *behaviour*, used to tell "exactly as the package
 * installed it" from "the user has since edited it".
 *
 * It must normalise identically whether it is handed a rendered package spec or
 * a record read back from routines.json, because upsertRoutine fills in
 * defaults the spec may omit. `enabled` is deliberately excluded: turning a
 * persona off disables its routines, and that must not read as a user edit.
 */
function routineFingerprint(r) {
  const canonical = {
    kind: r?.kind || null,
    schedule: r?.schedule || null,
    spec: r?.spec || {},
    permission_mode: r?.permission_mode || null,
    allowed_tools: r?.allowed_tools || [],
    pre_commands: r?.pre_commands || [],
    post_commands: r?.post_commands || [],
    skip_prompt_on: r?.skip_prompt_on || "signal",
  };
  return crypto.createHash("sha256").update(JSON.stringify(canonical)).digest("hex").slice(0, 16);
}

/**
 * Settings saved for one persona, whether or not it is the active one.
 *
 * `persona.config` always mirrors the ACTIVE persona's settings, because that
 * is the shape every reader expects. `persona.configs[<id>]` is the durable
 * per-persona store behind it, so switching A → B → A gives A its own settings
 * back instead of whatever B was configured with.
 */
function savedConfigFor(cfg, id) {
  const byId = cfg?.persona?.configs;
  if (byId && typeof byId === "object" && byId[id]) return byId[id];
  // First read after an upgrade: the active persona's flat config is its own.
  if (cfg?.persona?.active === id) return cfg.persona.config || {};
  return {};
}

/** Write settings for one persona into both the mirror and the per-id store. */
function persistConfigFor(cfg, id, values, { active }) {
  const configs = { ...(cfg.persona?.configs || {}), [id]: values };
  cfg.persona = {
    ...(cfg.persona || {}),
    active,
    configs,
    // The mirror always describes the ACTIVE persona, so it is {} while none
    // is active. Never undefined — readers treat it as a plain object.
    config: active ? (active === id ? values : configs[active] || {}) : {},
  };
  return cfg;
}

/** Where the super-agent's own routines live (they are not project-scoped). */
function superAgentStorage() {
  return projectStorageRoot(DEFAULT_PROJECT_ID);
}

function apxVersion() {
  try {
    const pkg = new URL("../../../package.json", import.meta.url);
    return JSON.parse(fs.readFileSync(pkg, "utf8")).version || null;
  } catch {
    return null;
  }
}

// --------------------- source resolution ------------------------------------

/**
 * Resolve what the user asked to install into a package directory.
 *
 * Kept behind one function so remote sources (a URL, a registry id) can be
 * added later without the callers changing — see 01-SPEC § 10.
 *
 * @returns {{ kind: "bundled"|"path", id: string, dir: string }}
 */
export function resolveInstallSource(source) {
  const raw = String(source || "").trim();
  if (!raw) throw new Error("persona install: missing <id|path>");

  if (/^https?:\/\//i.test(raw)) {
    throw new Error(
      "persona install: remote sources are not supported yet — clone the package and install from a local path"
    );
  }

  // A path if it looks like one, or if it exists on disk.
  const looksLikePath = raw.includes("/") || raw.startsWith(".");
  if (looksLikePath || fs.existsSync(raw)) {
    const dir = path.resolve(raw);
    if (!fs.existsSync(path.join(dir, MANIFEST_FILE))) {
      throw new Error(`persona install: no ${MANIFEST_FILE} found in ${dir}`);
    }
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, MANIFEST_FILE), "utf8"));
    const id = manifest.id || path.basename(dir);
    if (!PERSONA_ID_RE.test(id)) {
      throw new Error(`persona install: invalid id "${id}" (lowercase slug expected)`);
    }
    return { kind: "path", id, dir };
  }

  if (!PERSONA_ID_RE.test(raw)) {
    throw new Error(`persona install: invalid id "${raw}" (lowercase slug expected)`);
  }
  const found = readPersona(raw);
  if (!found) {
    const known = listPersonas().map((p) => p.id);
    throw new Error(
      `persona install: "${raw}" not found` +
      (known.length ? ` — available: ${known.join(", ")}` : "")
    );
  }
  return { kind: "bundled", id: raw, dir: found.dir };
}

function copyDirSync(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dst = path.join(to, entry.name);
    if (entry.isDirectory()) copyDirSync(src, dst);
    else if (entry.isFile()) fs.copyFileSync(src, dst);
  }
}

// --------------------- validation -------------------------------------------

/**
 * Everything that can be checked without activating: manifest, schema, prompt
 * renderability, and the declared token budget.
 */
export function validatePersonaPackage(persona, { globalConfig = null } = {}) {
  const cfg = globalConfig || readConfig();
  const identity = (() => { try { return readIdentity(); } catch { return null; } })();

  const errors = [];
  const warnings = [];

  const m = validateManifest(persona.manifest, { apxVersion: apxVersion() });
  errors.push(...m.errors);
  warnings.push(...m.warnings);

  const s = validateConfigSchema(persona.schema);
  errors.push(...s.errors);
  warnings.push(...s.warnings);

  // The prompt must exist and render cleanly.
  const promptFile = resolvePromptFile(persona.dir, "en");
  let tokens = 0;
  if (!promptFile) {
    errors.push(`persona "${persona.id}": no PERSONA.md found in ${persona.dir}`);
  } else {
    const rendered = renderPersonaPrompt(persona, {
      identity,
      globalConfig: { ...cfg, persona: { active: persona.id, config: schemaDefaults(persona.schema) } },
      lang: "en",
    });
    if (!rendered) {
      errors.push(`persona "${persona.id}": PERSONA.md renders to nothing`);
    }
    if (rendered.includes("{{")) {
      errors.push(`persona "${persona.id}": unresolved template variables survive rendering`);
    }
    tokens = estimateTokens(rendered);

    const budget = persona.manifest?.prompt_budget_tokens;
    if (budget) {
      if (tokens > budget * 1.5) {
        errors.push(
          `persona "${persona.id}": prompt is ~${tokens} tokens, more than 1.5x its declared ` +
          `budget of ${budget}. Trim PERSONA.md or raise prompt_budget_tokens.`
        );
      } else if (tokens > budget) {
        warnings.push(
          `persona "${persona.id}": prompt is ~${tokens} tokens against a declared budget of ` +
          `${budget}. It ships on every turn of every channel.`
        );
      }
    }
  }

  return { ok: errors.length === 0, errors, warnings, tokens };
}

// --------------------- install ----------------------------------------------

/**
 * Install a persona: validate it, make it resolvable, and seed its settings.
 * Does NOT activate — that is `usePersona`.
 */
export function installPersona(source, { force = false } = {}) {
  const resolved = resolveInstallSource(source);
  const warnings = [];

  // A local package is copied into the user layer, because it lives outside
  // APX and could move or vanish. A bundled package is NOT copied: copying it
  // would shadow the version APX ships and freeze the user on today's content
  // forever. See core/personas/store.js.
  if (resolved.kind === "path") {
    const dest = userPersonaDir(resolved.id);
    if (fs.existsSync(dest) && !force) {
      throw new Error(
        `persona "${resolved.id}" is already installed at ${dest} — pass --force to overwrite`
      );
    }
    if (path.resolve(resolved.dir) !== path.resolve(dest)) {
      fs.rmSync(dest, { recursive: true, force: true });
      copyDirSync(resolved.dir, dest);
    }
  }

  // Un-tombstone: reinstalling a bundled persona the user had removed.
  const tombstones = readPersonaTombstones();
  if (tombstones.delete(resolved.id)) writePersonaTombstones(tombstones);

  clearPersonaBlockCache();

  const persona = readPersona(resolved.id);
  if (!persona) throw new Error(`persona install: "${resolved.id}" did not resolve after install`);

  const report = validatePersonaPackage(persona);
  if (!report.ok) {
    // Roll the copy back so a failed install leaves nothing behind.
    if (resolved.kind === "path") {
      fs.rmSync(userPersonaDir(resolved.id), { recursive: true, force: true });
      clearPersonaBlockCache();
    }
    throw new Error(`persona install failed:\n  - ${report.errors.join("\n  - ")}`);
  }
  warnings.push(...report.warnings);

  // Seed settings with the schema defaults, keeping anything already saved for
  // this persona from a previous install.
  const cfg = readConfig();
  const state = readPersonaState(cfg);
  const settings = { ...schemaDefaults(persona.schema), ...savedConfigFor(cfg, resolved.id) };
  persistConfigFor(cfg, resolved.id, settings, { active: state.active });
  cfg.persona.installed_at = new Date().toISOString();
  cfg.persona.version = persona.manifest.version || null;
  writeConfig(cfg);

  return { persona, warnings, tokens: report.tokens, doctor: personaDoctor(resolved.id) };
}

// --------------------- routines ---------------------------------------------

/** The persona's routine specs, rendered against its effective settings. */
export function renderPersonaRoutines(persona, globalConfig) {
  const dir = path.join(persona.dir, "routines");
  if (!fs.existsSync(dir)) return [];

  const settings = effectivePersonaConfig(persona, globalConfig);
  const out = [];

  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
    let raw;
    try {
      raw = JSON.parse(renderPromptTemplate(fs.readFileSync(path.join(dir, file), "utf8"), settings));
    } catch (e) {
      throw new Error(`persona "${persona.id}": routines/${file} is not valid JSON after rendering — ${e.message}`);
    }
    if (!raw?.name || !raw?.kind || !raw?.schedule) {
      throw new Error(`persona "${persona.id}": routines/${file} needs name, kind and schedule`);
    }
    // Namespaced, because `name` is the real primary key of the routines store
    // and a persona must never collide with a routine the user wrote.
    out.push({ ...raw, name: `${persona.id}-${raw.name}` });
  }
  return out;
}

function personaOrigin(id) {
  return `persona:${id}`;
}

/** Install (or refresh) the routines a persona brings. Returns a summary. */
export function syncPersonaRoutines(persona, globalConfig, { enable = true } = {}) {
  const storage = superAgentStorage();
  const specs = renderPersonaRoutines(persona, globalConfig);
  const existing = listRoutines(storage);
  const origin = personaOrigin(persona.id);

  const installed = [];
  const skipped = [];

  for (const spec of specs) {
    const { name, enabled_by_default, ...rest } = spec;
    const prev = existing.find((r) => r.name === name);
    const hash = routineFingerprint(rest);

    // The user edited a routine this package installed → never touch it again.
    // Compare the record against the fingerprint taken when it was installed,
    // NOT against the newly rendered spec: a changed setting legitimately
    // changes the rendering, and that must still be applied.
    if (
      prev &&
      prev.origin === origin &&
      prev.origin_hash &&
      routineFingerprint(prev) !== prev.origin_hash
    ) {
      skipped.push({ name, reason: "user_modified" });
      continue;
    }
    // A routine of the same name the user owns → do not hijack it.
    if (prev && prev.origin && prev.origin !== origin) {
      skipped.push({ name, reason: "owned_by_other" });
      continue;
    }
    if (prev && !prev.origin) {
      skipped.push({ name, reason: "user_owned" });
      continue;
    }

    upsertRoutine(storage, {
      ...rest,
      name,
      enabled: enable && enabled_by_default !== false,
      origin,
      origin_hash: hash,
    });
    installed.push(name);
  }

  return { installed, skipped };
}

/** Disable — never delete — the routines a persona installed. */
export function disablePersonaRoutines(personaId) {
  const storage = superAgentStorage();
  const origin = personaOrigin(personaId);
  const touched = [];
  for (const r of listRoutines(storage)) {
    if (r.origin === origin && r.enabled) {
      setEnabled(storage, r.name, false);
      touched.push(r.name);
    }
  }
  return touched;
}

/** Remove the routines a persona installed, preserving any the user edited. */
export function removePersonaRoutines(personaId) {
  const storage = superAgentStorage();
  const origin = personaOrigin(personaId);
  const removed = [];
  const kept = [];
  for (const r of listRoutines(storage)) {
    if (r.origin !== origin) continue;
    // No hash, or a hash that no longer matches, means the user made it theirs.
    const isUntouched = !!r.origin_hash && r.origin_hash === routineFingerprint(r);
    if (isUntouched) {
      deleteRoutine(storage, r.name);
      removed.push(r.name);
    } else {
      kept.push(r.name);
    }
  }
  return { removed, kept };
}

// --------------------- use / off --------------------------------------------

export function usePersona(id, { confirmReplace = false } = {}) {
  const persona = readPersona(id);
  if (!persona) throw new Error(`persona "${id}" is not installed — run: apx persona install ${id}`);

  const cfg = readConfig();
  const state = readPersonaState(cfg);

  if (state.active && state.active !== id && !confirmReplace) {
    throw new Error(
      `persona "${state.active}" is already active. Only one persona runs at a time — ` +
      `re-run with --force to replace it.`
    );
  }

  const report = validatePersonaPackage(persona, { globalConfig: cfg });
  if (!report.ok) {
    throw new Error(`persona "${id}" cannot be activated:\n  - ${report.errors.join("\n  - ")}`);
  }

  // Stand the previous persona's routines down before the new one's go up.
  if (state.active && state.active !== id) disablePersonaRoutines(state.active);

  const settings = { ...schemaDefaults(persona.schema), ...savedConfigFor(cfg, id) };
  persistConfigFor(cfg, id, settings, { active: id });
  cfg.persona.version = persona.manifest.version || null;
  writeConfig(cfg);
  clearPersonaBlockCache();

  const routines = syncPersonaRoutines(persona, cfg);
  return { persona, routines, warnings: report.warnings, tokens: report.tokens };
}

export function offPersona() {
  const cfg = readConfig();
  const state = readPersonaState(cfg);
  if (!state.active) return { was: null, routines: [] };

  const routines = disablePersonaRoutines(state.active);

  // Settings are kept, so `use` again restores exactly what the user had.
  cfg.persona = { ...(cfg.persona || {}), active: null };
  writeConfig(cfg);
  clearPersonaBlockCache();

  return { was: state.active, routines };
}

// --------------------- config -----------------------------------------------

/**
 * Update the active persona's settings. Changing a schedule setting really
 * moves the cron — the routines are re-rendered and re-installed.
 */
export function setPersonaConfig(values, { id = null } = {}) {
  const cfg = readConfig();
  const state = readPersonaState(cfg);
  const targetId = id || state.active;
  if (!targetId) throw new Error("no persona is active — run: apx persona use <id>");

  const persona = readPersona(targetId);
  if (!persona) throw new Error(`persona "${targetId}" is not installed`);

  const { ok, errors, value } = validateConfigValues(persona.schema, values);
  if (!ok) throw new Error(`invalid persona config:\n  - ${errors.join("\n  - ")}`);

  const settings = {
    ...schemaDefaults(persona.schema),
    ...savedConfigFor(cfg, targetId),
    ...value,
  };
  persistConfigFor(cfg, targetId, settings, { active: state.active });
  writeConfig(cfg);
  clearPersonaBlockCache();

  // Changing day_open_at has to move the actual cron, not just the JSON — so
  // the persona's routines are re-rendered and re-installed.
  const routines =
    state.active === targetId ? syncPersonaRoutines(persona, cfg) : { installed: [], skipped: [] };

  return { config: settings, changed: Object.keys(value), routines };
}

// --------------------- doctor -----------------------------------------------

/**
 * What is missing for this persona to do its job. Actionable lines, not a
 * status dump — every entry says what to run.
 */
export function personaDoctor(id = null) {
  const cfg = readConfig();
  const state = readPersonaState(cfg);
  const targetId = id || state.active;

  if (!targetId) {
    return { id: null, active: false, ok: true, checks: [], summary: "No persona active (vanilla)." };
  }

  const persona = readPersona(targetId);
  if (!persona) {
    return {
      id: targetId,
      active: false,
      ok: false,
      checks: [{ level: "error", label: "package", detail: `not installed`, fix: `apx persona install ${targetId}` }],
      summary: `persona "${targetId}" is not installed`,
    };
  }

  const checks = [];
  const report = validatePersonaPackage(persona, { globalConfig: cfg });
  for (const e of report.errors) checks.push({ level: "error", label: "package", detail: e, fix: null });
  for (const w of report.warnings) checks.push({ level: "warn", label: "package", detail: w, fix: null });

  const requires = persona.manifest?.requires || {};

  // Channels the persona expects to speak through.
  for (const ch of requires.channels || []) {
    if (ch === "telegram") {
      const configured = (cfg.telegram?.channels || []).length > 0 || !!cfg.telegram?.bot_token;
      if (!configured) {
        checks.push({
          level: "warn",
          label: "channel",
          detail: `Telegram is not configured — the persona cannot reach you there`,
          fix: "apx telegram setup",
        });
      }
    }
  }

  // Integrations. Required ones block; optional ones degrade.
  for (const slug of requires.integrations || []) {
    if (!cfg.integrations?.[slug]) {
      checks.push({ level: "error", label: "integration", detail: `${slug} is required and not connected`, fix: `apx integration connect ${slug}` });
    }
  }
  for (const slug of requires.optional_integrations || []) {
    if (!cfg.integrations?.[slug]) {
      checks.push({ level: "warn", label: "integration", detail: `${slug} is not connected — the persona degrades without it`, fix: `apx integration connect ${slug}` });
    }
  }

  // Core capabilities the package declares it needs. Unknown ones are reported
  // rather than silently ignored, so a package can't quietly depend on nothing.
  for (const cap of requires.capabilities || []) {
    if (!CORE_CAPABILITIES.has(cap)) {
      checks.push({
        level: "warn",
        label: "capability",
        detail: `"${cap}" is not provided by this APX version — the persona degrades`,
        fix: null,
      });
    }
  }

  // Routines it installed that are currently off.
  if (state.active === targetId) {
    const origin = personaOrigin(targetId);
    const off = listRoutines(superAgentStorage()).filter((r) => r.origin === origin && !r.enabled);
    for (const r of off) {
      checks.push({ level: "warn", label: "routine", detail: `"${r.name}" is disabled`, fix: `apx routine enable ${r.name}` });
    }
  }

  const errors = checks.filter((c) => c.level === "error").length;
  return {
    id: targetId,
    active: state.active === targetId,
    ok: errors === 0,
    tokens: report.tokens,
    budget: persona.manifest?.prompt_budget_tokens || null,
    checks,
    summary: errors === 0
      ? `persona "${targetId}" is healthy${checks.length ? ` (${checks.length} warning(s))` : ""}`
      : `persona "${targetId}" has ${errors} blocking problem(s)`,
  };
}

/**
 * Core capabilities a persona package may declare in `requires.capabilities`.
 * Grow this as the capabilities in 02-SPEC land.
 */
export const CORE_CAPABILITIES = new Set([
  "routine.memory",
]);

// --------------------- uninstall --------------------------------------------

export function uninstallPersona(id) {
  const persona = readPersona(id);
  if (!persona) throw new Error(`persona "${id}" is not installed`);

  const cfg = readConfig();
  const state = readPersonaState(cfg);

  if (state.active === id) {
    disablePersonaRoutines(id);
    cfg.persona = { ...(cfg.persona || {}), active: null };
    writeConfig(cfg);
  }

  const routines = removePersonaRoutines(id);

  // A bundled package can't be deleted, so it gets a tombstone — the same
  // mechanism the agent vault uses.
  let removedDir = null;
  if (persona.source === "bundled") {
    const tombstones = readPersonaTombstones();
    tombstones.add(id);
    writePersonaTombstones(tombstones);
  } else {
    removedDir = userPersonaDir(id);
    fs.rmSync(removedDir, { recursive: true, force: true });
    // An override disappearing re-exposes the bundled package underneath.
    if (persona.source === "user") {
      const tombstones = readPersonaTombstones();
      if (tombstones.delete(id)) writePersonaTombstones(tombstones);
    }
  }

  clearPersonaBlockCache();
  return { id, source: persona.source, removedDir, routines };
}

// --------------------- listing ----------------------------------------------

/** Everything a surface needs to render the persona list. */
export function listPersonasWithState(globalConfig = null) {
  const cfg = globalConfig || readConfig();
  const state = readPersonaState(cfg);
  return listPersonas().map((p) => ({
    id: p.id,
    name: p.manifest.name || p.id,
    version: p.manifest.version || null,
    description: p.manifest.description || "",
    author: p.manifest.author || null,
    languages: p.manifest.languages || ["en"],
    source: p.source,
    active: state.active === p.id,
    dir: p.dir,
  }));
}

export { readActivePersona, readPersonaState, effectivePersonaConfig };
