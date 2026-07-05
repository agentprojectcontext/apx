// Integration storage. Integrations are per-project records that hold plugin
// credentials + resolved metadata (Asana PAT, workspace gid, connected user…).
//
// Scoping model (see IntegrationStore + resolveIntegration in ./store.js):
//   - Every integration lives in ONE project's integrations.json.
//   - "Global" integrations are simply the ones stored under the DEFAULT project
//     (~/.apx/projects/default/integrations.json). There is no separate global
//     file: this keeps "which Asana does project X use?" unambiguous — a project
//     uses its own record if present, otherwise it falls back to the default's.
//
// The file may contain tokens, so it is written chmod 0600 exactly like the
// runtime MCP + vars stores.
import fs from "node:fs";
import path from "node:path";
import { DEFAULT_PROJECT_STORE } from "#core/config/index.js";

const INTEGRATIONS_FILENAME = "integrations.json";

// Absolute path to a project's integrations.json given its storagePath
// (~/.apx/projects/<apxId>/). Returns null when no storagePath is available.
export function integrationsPath(storagePath) {
  if (!storagePath) return null;
  return path.join(storagePath, INTEGRATIONS_FILENAME);
}

// The storagePath of the DEFAULT project — the home of "global" integrations.
export function defaultIntegrationsStorage() {
  return DEFAULT_PROJECT_STORE;
}

// Read the raw array of integration records for a project. Always returns an
// array (missing/corrupt file → []).
export function readIntegrations(storagePath) {
  const p = integrationsPath(storagePath);
  if (!p || !fs.existsSync(p)) return [];
  try {
    const json = JSON.parse(fs.readFileSync(p, "utf8"));
    return Array.isArray(json) ? json : [];
  } catch {
    return [];
  }
}

// Persist the array of integration records for a project. Creates the storage
// directory if needed and locks the file to 0600 (tokens live here).
export function writeIntegrations(storagePath, entries) {
  const p = integrationsPath(storagePath);
  if (!p) throw new Error("writeIntegrations: storagePath required");
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(entries, null, 2) + "\n");
  try {
    fs.chmodSync(p, 0o600);
  } catch {
    // best-effort on non-POSIX filesystems (Windows) — ignore.
  }
}
