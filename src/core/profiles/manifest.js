// profile.json + config.schema.json validation.
//
// The schema support is a deliberate subset — type / enum / default / title /
// description / required — so a profile package can describe its white-label
// variables without APX taking on a JSON Schema dependency. Anything richer
// belongs in the profile's own logic, not in the manifest.
import { PROFILE_ID_RE } from "./paths.js";

const REQUIRED_FIELDS = ["id", "name", "version"];
const SUPPORTED_TYPES = new Set(["string", "integer", "number", "boolean"]);

/** Semver-ish compare. Returns -1 / 0 / 1. Ignores pre-release tags. */
export function compareVersions(a, b) {
  const parse = (v) =>
    String(v || "0")
      .split("-")[0]
      .split(".")
      .map((n) => parseInt(n, 10) || 0);
  const [x, y] = [parse(a), parse(b)];
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] || 0) - (y[i] || 0);
    if (d !== 0) return d > 0 ? 1 : -1;
  }
  return 0;
}

/**
 * Validate a profile manifest.
 * @returns {{ ok: boolean, errors: string[], warnings: string[] }}
 */
export function validateManifest(manifest, { apxVersion = null } = {}) {
  const errors = [];
  const warnings = [];

  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    return { ok: false, errors: ["profile.json must be a JSON object"], warnings };
  }

  for (const field of REQUIRED_FIELDS) {
    if (!manifest[field] || typeof manifest[field] !== "string") {
      errors.push(`profile.json: "${field}" is required and must be a string`);
    }
  }

  if (manifest.id && !PROFILE_ID_RE.test(manifest.id)) {
    errors.push(
      `profile.json: "id" must be a lowercase slug (a-z, 0-9, dashes) — got "${manifest.id}"`
    );
  }

  if (manifest.languages != null && !Array.isArray(manifest.languages)) {
    errors.push('profile.json: "languages" must be an array of language codes');
  }

  if (manifest.prompt_budget_tokens != null) {
    const n = manifest.prompt_budget_tokens;
    if (!Number.isInteger(n) || n <= 0) {
      errors.push('profile.json: "prompt_budget_tokens" must be a positive integer');
    }
  }

  // apx_min_version gates installation, but only warns when we can't tell.
  if (manifest.apx_min_version) {
    if (!apxVersion) {
      warnings.push(
        `could not determine the running APX version to check apx_min_version ` +
        `(${manifest.apx_min_version})`
      );
    } else if (compareVersions(apxVersion, manifest.apx_min_version) < 0) {
      errors.push(
        `profile "${manifest.id}" needs APX >= ${manifest.apx_min_version}, ` +
        `this is ${apxVersion}`
      );
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}

/**
 * Validate a config.schema.json (the white-label variable declaration).
 * Every property must carry a default — installing a profile and configuring
 * nothing has to yield a working system, not a questionnaire.
 */
export function validateConfigSchema(schema) {
  const errors = [];
  const warnings = [];

  if (schema == null) return { ok: true, errors, warnings };
  if (typeof schema !== "object" || Array.isArray(schema)) {
    return { ok: false, errors: ["config.schema.json must be a JSON object"], warnings };
  }
  if (schema.type && schema.type !== "object") {
    errors.push('config.schema.json: top-level "type" must be "object"');
  }

  const props = schema.properties || {};
  if (typeof props !== "object" || Array.isArray(props)) {
    return { ok: false, errors: ['config.schema.json: "properties" must be an object'], warnings };
  }

  for (const [key, def] of Object.entries(props)) {
    if (!def || typeof def !== "object") {
      errors.push(`config.schema.json: property "${key}" must be an object`);
      continue;
    }
    if (def.type && !SUPPORTED_TYPES.has(def.type)) {
      errors.push(
        `config.schema.json: property "${key}" has unsupported type "${def.type}" ` +
        `(supported: ${[...SUPPORTED_TYPES].join(", ")})`
      );
    }
    if (def.enum != null && (!Array.isArray(def.enum) || def.enum.length === 0)) {
      errors.push(`config.schema.json: property "${key}" — "enum" must be a non-empty array`);
    }
    if (def.default === undefined) {
      warnings.push(
        `config.schema.json: property "${key}" has no default — a profile should work ` +
        `before the user configures anything`
      );
    } else if (def.enum && !def.enum.includes(def.default)) {
      errors.push(
        `config.schema.json: property "${key}" — default "${def.default}" is not in its enum`
      );
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}

/** Every property's default, as a plain object. Missing defaults are skipped. */
export function schemaDefaults(schema) {
  const out = {};
  const props = schema?.properties || {};
  for (const [key, def] of Object.entries(props)) {
    if (def && def.default !== undefined) out[key] = def.default;
  }
  return out;
}

function coerce(value, type) {
  if (type === "integer" || type === "number") {
    const n = Number(value);
    if (!Number.isFinite(n)) return { ok: false };
    if (type === "integer" && !Number.isInteger(n)) return { ok: false };
    return { ok: true, value: n };
  }
  if (type === "boolean") {
    if (typeof value === "boolean") return { ok: true, value };
    const s = String(value).toLowerCase();
    if (["true", "1", "yes", "on"].includes(s)) return { ok: true, value: true };
    if (["false", "0", "no", "off"].includes(s)) return { ok: true, value: false };
    return { ok: false };
  }
  return { ok: true, value: String(value) };
}

/**
 * Validate + coerce a config patch against the schema.
 * CLI flags arrive as strings, so values are coerced to the declared type
 * rather than rejected for being "3" instead of 3.
 *
 * @returns {{ ok: boolean, errors: string[], value: object }}
 */
export function validateConfigValues(schema, values = {}) {
  const errors = [];
  const out = {};
  const props = schema?.properties || {};

  for (const [key, raw] of Object.entries(values || {})) {
    const def = props[key];
    if (!def) {
      const known = Object.keys(props);
      errors.push(
        `unknown setting "${key}"` +
        (known.length ? ` — this profile accepts: ${known.join(", ")}` : "")
      );
      continue;
    }
    const { ok, value } = coerce(raw, def.type || "string");
    if (!ok) {
      errors.push(`"${key}" must be a ${def.type} — got "${raw}"`);
      continue;
    }
    if (def.enum && !def.enum.includes(value)) {
      errors.push(`"${key}" must be one of: ${def.enum.join(", ")} — got "${value}"`);
      continue;
    }
    out[key] = value;
  }

  return { ok: errors.length === 0, errors, value: out };
}
