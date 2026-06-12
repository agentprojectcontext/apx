// Variable storage for APX. Two scopes:
//   global  — ~/.apx/vars.json                              (chmod 0600)
//   project — <storagePath>/vars.json                       (chmod 0600)
//             i.e. ~/.apx/projects/<apxId>/vars.json
//
// Both files live outside the project repo so values never get committed.
// The .apc/ files committed to the repo only reference vars by name
// (e.g. `${var.ASANA_TOKEN}`) — actual values live here.
//
// Each file is a flat object: { "NAME": "value", ... }. Names are
// uppercase letters / digits / underscore by convention (we don't enforce it
// — anything safe to interpolate works).
//
// project wins over global when the same name exists in both.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const APX_HOME = path.join(os.homedir(), ".apx");
const GLOBAL_VARS_FILE = path.join(APX_HOME, "vars.json");
const PROJECT_VARS_FILENAME = "vars.json";

export function globalVarsPath() {
  return GLOBAL_VARS_FILE;
}

export function projectVarsPath(storagePath) {
  if (!storagePath) return null;
  return path.join(storagePath, PROJECT_VARS_FILENAME);
}

function readJsonSafe(absPath) {
  if (!absPath || !fs.existsSync(absPath)) return {};
  try {
    const json = JSON.parse(fs.readFileSync(absPath, "utf8"));
    return json && typeof json === "object" && !Array.isArray(json) ? json : {};
  } catch {
    return {};
  }
}

function writeJsonSecure(absPath, obj) {
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, JSON.stringify(obj, null, 2) + "\n");
  try {
    fs.chmodSync(absPath, 0o600);
  } catch {
    // Best effort on non-POSIX filesystems.
  }
}

export function readGlobalVars() {
  return readJsonSafe(GLOBAL_VARS_FILE);
}

export function writeGlobalVars(obj) {
  writeJsonSecure(GLOBAL_VARS_FILE, obj);
}

export function readProjectVars(storagePath) {
  return readJsonSafe(projectVarsPath(storagePath));
}

export function writeProjectVars(storagePath, obj) {
  if (!storagePath) throw new Error("writeProjectVars: storagePath required");
  writeJsonSecure(projectVarsPath(storagePath), obj);
}

function sanitizeMap(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj || {})) {
    out[k] = String(v)
      .replace(/[\u200B-\u200F\u202A-\u202E\u2060\uFEFF]/g, "")
      .replace(/\u00A0/g, " ")
      .trim();
  }
  return out;
}

// Aggregate project + global with project winning.
// Returns { project, global, effective, sources } where sources[name] is
// "project" or "global" so callers know where each effective value came from.
// Values are sanitized at read time so legacy entries written before the
// save-time trim land also come out clean.
export function loadAllVars({ storagePath } = {}) {
  const project = sanitizeMap(storagePath ? readProjectVars(storagePath) : {});
  const global = sanitizeMap(readGlobalVars());
  const effective = { ...global, ...project };
  const sources = {};
  for (const name of Object.keys(global)) sources[name] = "global";
  for (const name of Object.keys(project)) sources[name] = "project";
  return { project, global, effective, sources };
}

// Strip leading/trailing whitespace + invisible chars (ZWSP, BOM, …). The #1
// reason a pasted token "doesn't work" is a stray newline picked up from the
// copy buffer; defaulting to trim removes that whole class of bugs while
// leaving real values untouched.
function sanitizeVarValue(raw) {
  return String(raw)
    .replace(/[\u200B-\u200F\u202A-\u202E\u2060\uFEFF]/g, "")
    .replace(/\u00A0/g, " ")
    .trim();
}

// Convenience: set/unset on either scope. Returns the new full object.
export function setVar({ storagePath, scope, name, value }) {
  const v = sanitizeVarValue(value);
  if (scope === "project") {
    if (!storagePath) throw new Error("project scope requires storagePath");
    const obj = readProjectVars(storagePath);
    obj[name] = v;
    writeProjectVars(storagePath, obj);
    return obj;
  }
  if (scope === "global") {
    const obj = readGlobalVars();
    obj[name] = v;
    writeGlobalVars(obj);
    return obj;
  }
  throw new Error(`unknown scope "${scope}"`);
}

export function deleteVar({ storagePath, scope, name }) {
  if (scope === "project") {
    if (!storagePath) throw new Error("project scope requires storagePath");
    const obj = readProjectVars(storagePath);
    if (!(name in obj)) return false;
    delete obj[name];
    writeProjectVars(storagePath, obj);
    return true;
  }
  if (scope === "global") {
    const obj = readGlobalVars();
    if (!(name in obj)) return false;
    delete obj[name];
    writeGlobalVars(obj);
    return true;
  }
  throw new Error(`unknown scope "${scope}"`);
}

// Mask helper for read paths — never send the raw value to the UI by default.
export function maskValue(value) {
  if (value == null) return "";
  const s = String(value);
  if (s.length <= 4) return "•".repeat(s.length);
  return "•".repeat(Math.min(s.length - 4, 8)) + s.slice(-4);
}
