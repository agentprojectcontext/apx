// IntegrationStore: CRUD over one project's integrations.json, plus the
// cross-scope resolution used by agent tools. Pure filesystem + data logic —
// no Express, no plugin HTTP calls (those live in ./plugins/*). This keeps the
// storage layer testable in isolation (see tests/integrations.test.js).
import {
  readIntegrations,
  writeIntegrations,
  defaultIntegrationsStorage,
} from "./sources.js";

// Keys inside `config` that hold secrets — never sent to the web UI in clear.
const SECRET_KEYS = new Set([
  "personal_access_token",
  "token",
  "api_key",
  "client_secret",
]);

// Return a shallow copy of a record with secret config values masked, safe to
// send to the browser. A present secret becomes `true` under `config.<key>_set`
// so the UI can show "configured" without leaking the value.
export function redactRecord(record) {
  if (!record) return record;
  const config = { ...(record.config || {}) };
  for (const key of Object.keys(config)) {
    if (SECRET_KEYS.has(key)) {
      const hasValue = typeof config[key] === "string" && config[key].length > 0;
      delete config[key];
      config[`${key}_set`] = hasValue;
    }
  }
  return { ...record, config };
}

export class IntegrationStore {
  // `storagePath` is a project's ~/.apx/projects/<apxId>/ directory.
  constructor(storagePath) {
    if (!storagePath) throw new Error("IntegrationStore: storagePath required");
    this.storagePath = storagePath;
  }

  list() {
    return readIntegrations(this.storagePath);
  }

  get(slug) {
    return this.list().find((r) => r.slug === slug) || null;
  }

  // Insert or merge a record by slug. `patch` is shallow-merged; `patch.config`
  // is deep-merged one level so callers can update a single config key without
  // clobbering the token. Returns the persisted record.
  upsert(slug, patch = {}) {
    const entries = this.list();
    const idx = entries.findIndex((r) => r.slug === slug);
    const now = new Date().toISOString();
    if (idx === -1) {
      const record = {
        slug,
        name: patch.name || slug,
        type: patch.type || "custom",
        description: patch.description || "",
        source: patch.source || "builtin",
        status: patch.status || "disconnected",
        is_enabled: patch.is_enabled ?? false,
        config: patch.config || {},
        created_at: now,
        updated_at: now,
      };
      entries.push(record);
      writeIntegrations(this.storagePath, entries);
      return record;
    }
    const prev = entries[idx];
    const merged = {
      ...prev,
      ...patch,
      config: { ...(prev.config || {}), ...(patch.config || {}) },
      updated_at: now,
    };
    entries[idx] = merged;
    writeIntegrations(this.storagePath, entries);
    return merged;
  }

  remove(slug) {
    const entries = this.list();
    const next = entries.filter((r) => r.slug !== slug);
    if (next.length === entries.length) return false;
    writeIntegrations(this.storagePath, next);
    return true;
  }
}

// Resolve the effective integration for `slug` in a project, applying the
// project→default precedence: a project's OWN enabled record wins; otherwise
// the default project's enabled record is used. Returns { record, scope } or
// null when neither is usable. `defaultStorage` defaults to the default
// project's storage so callers only need the current project's storagePath.
export function resolveIntegration({
  projectStorage,
  slug,
  defaultStorage = defaultIntegrationsStorage(),
  requireEnabled = true,
}) {
  const usable = (record) =>
    !!record && (!requireEnabled || (record.is_enabled && record.status === "active"));

  if (projectStorage) {
    const own = new IntegrationStore(projectStorage).get(slug);
    if (usable(own)) return { record: own, scope: "project", storagePath: projectStorage };
  }
  if (defaultStorage && defaultStorage !== projectStorage) {
    const fallback = new IntegrationStore(defaultStorage).get(slug);
    if (usable(fallback)) return { record: fallback, scope: "global", storagePath: defaultStorage };
  }
  return null;
}
