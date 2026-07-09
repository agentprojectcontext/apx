// Integration plugins per project. Companion to api/mcps.js: MCP servers are
// raw tool endpoints; integrations are higher-level plugins (Asana today) that
// own a credential + lifecycle and expose named tools to agents.
//
// Scoping (see core/integrations/store.js): every record lives in one project's
// integrations.json. `?scope=global` targets the DEFAULT project's store, so
// "global" integrations are literally the default project's — a project without
// its own record falls back to that one. This keeps "which Asana runs here?"
// unambiguous when you have both a base Asana and a per-project Asana.
//
//   GET    /projects/:pid/integrations?scope=project|global      list stored (redacted)
//   GET    /projects/:pid/integrations/catalog                   roster + resolved status
//   GET    /projects/:pid/integrations/:slug?scope=…             one plugin status
//   POST   /projects/:pid/integrations/:slug/configure?scope=…   save credentials
//   POST   /projects/:pid/integrations/:slug/validate?scope=…    verify against provider
//   POST   /projects/:pid/integrations/:slug/deactivate?scope=…  disable
//   POST   /projects/:pid/integrations/:slug/action/:action?scope=…  plugin read action
//   DELETE /projects/:pid/integrations/:slug?scope=…             remove
import {
  IntegrationStore,
  resolveIntegration,
  redactRecord,
  defaultIntegrationsStorage,
  listCatalog,
  getPluginService,
  reconcilePluginMcp,
} from "#core/integrations/index.js";

function normalizeScope(raw) {
  if (!raw) return "project";
  const s = String(raw).toLowerCase();
  if (s === "global" || s === "default") return "global";
  if (s === "project" || s === "shared" || s === "runtime") return "project";
  return null;
}

// Resolve the storagePath for the requested scope. `global` → default project
// store; `project` → the current project's store.
function storagePathForScope(scope, p, projects) {
  if (scope === "global") {
    const base = projects.get(0);
    return base?.storagePath || defaultIntegrationsStorage();
  }
  return p.storagePath || null;
}

export function register(app, { projects, project, registries }) {
  // Keep a plugin's optional auto-registered MCP server (svc.mcpServer hook) in
  // lockstep with its stored state. Best-effort: a failure here must not break
  // the configure/validate/deactivate/delete response. `storagePath` is the one
  // the handler wrote to (so global-scope records resolve from the default
  // store), `scope` is the integration scope ("project" | "global").
  function reconcileMcp(svc, storagePath, scope, p) {
    if (typeof svc?.mcpServer !== "function") return;
    try {
      const record = storagePath ? new IntegrationStore(storagePath).get(svc.slug) : null;
      const desired = svc.mcpServer(record);
      reconcilePluginMcp({ desired, integrationScope: scope, project: p, projects, registries });
    } catch {
      /* best-effort MCP reconcile — ignore */
    }
  }

  // List stored integrations in the chosen scope (secrets redacted).
  app.get("/projects/:pid/integrations", (req, res) => {
    const p = project(req, res);
    if (!p) return;
    const scope = normalizeScope(req.query?.scope);
    if (scope === null) return res.status(400).json({ error: `unknown scope "${req.query?.scope}"` });
    const storagePath = storagePathForScope(scope, p, projects);
    if (!storagePath) return res.status(400).json({ error: "project has no storage path" });
    const records = new IntegrationStore(storagePath).list().map(redactRecord);
    res.json(records);
  });

  // The full plugin roster with each plugin's resolved status for this project
  // (project record wins over the default/global one).
  app.get("/projects/:pid/integrations/catalog", (req, res) => {
    const p = project(req, res);
    if (!p) return;
    const catalog = listCatalog().map((entry) => {
      const svc = getPluginService(entry.slug);
      let status = { slug: entry.slug, status: "disconnected", is_enabled: false };
      let scope = null;
      if (svc) {
        const resolved = resolveIntegration({
          projectStorage: p.storagePath,
          slug: entry.slug,
          requireEnabled: false,
        });
        status = svc.status(resolved?.record || null);
        scope = resolved?.scope || null;
      }
      return { ...entry, status, resolved_scope: scope };
    });
    res.json(catalog);
  });

  // Status for a single plugin in the chosen scope.
  app.get("/projects/:pid/integrations/:slug", (req, res) => {
    const p = project(req, res);
    if (!p) return;
    const svc = getPluginService(req.params.slug);
    if (!svc) return res.status(404).json({ error: `unknown plugin "${req.params.slug}"` });
    const scope = normalizeScope(req.query?.scope);
    if (scope === null) return res.status(400).json({ error: `unknown scope "${req.query?.scope}"` });
    const storagePath = storagePathForScope(scope, p, projects);
    if (!storagePath) return res.status(400).json({ error: "project has no storage path" });
    const record = new IntegrationStore(storagePath).get(req.params.slug);
    res.json(svc.status(record));
  });

  // Save credentials / config. Creates the record if missing.
  app.post("/projects/:pid/integrations/:slug/configure", (req, res) => {
    const p = project(req, res);
    if (!p) return;
    const svc = getPluginService(req.params.slug);
    if (!svc) return res.status(404).json({ error: `unknown plugin "${req.params.slug}"` });
    const scope = normalizeScope(req.query?.scope);
    if (scope === null) return res.status(400).json({ error: `unknown scope "${req.query?.scope}"` });
    const storagePath = storagePathForScope(scope, p, projects);
    if (!storagePath) return res.status(400).json({ error: "project has no storage path" });
    const store = new IntegrationStore(storagePath);
    try {
      const { patch } = svc.configure(store.get(req.params.slug), req.body || {});
      const record = store.upsert(req.params.slug, patch);
      reconcileMcp(svc, storagePath, scope, p);
      res.status(201).json(redactRecord(record));
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  // Verify the stored credentials against the provider, then persist the result.
  app.post("/projects/:pid/integrations/:slug/validate", async (req, res) => {
    const p = project(req, res);
    if (!p) return;
    const svc = getPluginService(req.params.slug);
    if (!svc) return res.status(404).json({ error: `unknown plugin "${req.params.slug}"` });
    const scope = normalizeScope(req.query?.scope);
    if (scope === null) return res.status(400).json({ error: `unknown scope "${req.query?.scope}"` });
    const storagePath = storagePathForScope(scope, p, projects);
    if (!storagePath) return res.status(400).json({ error: "project has no storage path" });
    const store = new IntegrationStore(storagePath);
    const record = store.get(req.params.slug);
    if (!record) return res.status(404).json({ error: "integration not configured" });
    try {
      const { patch, result } = await svc.validate(record);
      store.upsert(req.params.slug, patch);
      reconcileMcp(svc, storagePath, scope, p);
      if (result && result.ok === false) return res.status(400).json(result);
      res.json(result);
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  // Disable a plugin without deleting its stored credentials.
  app.post("/projects/:pid/integrations/:slug/deactivate", (req, res) => {
    const p = project(req, res);
    if (!p) return;
    const svc = getPluginService(req.params.slug);
    if (!svc) return res.status(404).json({ error: `unknown plugin "${req.params.slug}"` });
    const scope = normalizeScope(req.query?.scope);
    if (scope === null) return res.status(400).json({ error: `unknown scope "${req.query?.scope}"` });
    const storagePath = storagePathForScope(scope, p, projects);
    if (!storagePath) return res.status(400).json({ error: "project has no storage path" });
    const store = new IntegrationStore(storagePath);
    if (!store.get(req.params.slug)) return res.status(404).json({ error: "integration not configured" });
    const { patch } = svc.deactivate(store.get(req.params.slug));
    const record = store.upsert(req.params.slug, patch);
    reconcileMcp(svc, storagePath, scope, p);
    res.json(svc.status(record));
  });

  // Plugin-specific read action (e.g. Asana → list workspaces for the token).
  app.post("/projects/:pid/integrations/:slug/action/:action", async (req, res) => {
    const p = project(req, res);
    if (!p) return;
    const svc = getPluginService(req.params.slug);
    if (!svc) return res.status(404).json({ error: `unknown plugin "${req.params.slug}"` });
    const fn = svc.actions?.[req.params.action];
    if (typeof fn !== "function") {
      return res.status(404).json({ error: `unknown action "${req.params.action}"` });
    }
    const scope = normalizeScope(req.query?.scope);
    if (scope === null) return res.status(400).json({ error: `unknown scope "${req.query?.scope}"` });
    const storagePath = storagePathForScope(scope, p, projects);
    if (!storagePath) return res.status(400).json({ error: "project has no storage path" });
    const record = new IntegrationStore(storagePath).get(req.params.slug);
    if (!record) return res.status(404).json({ error: "integration not configured" });
    try {
      // Actions get a 2nd ctx arg (existing plugins ignore it). Obsidian's
      // sync_memory uses it to reach every project's memory.md.
      const actionCtx = { storagePath, scope, project: p, projects, registries };
      res.json(await fn.call(svc.actions, record, actionCtx));
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  // Remove a stored integration entirely.
  app.delete("/projects/:pid/integrations/:slug", (req, res) => {
    const p = project(req, res);
    if (!p) return;
    const scope = normalizeScope(req.query?.scope);
    if (scope === null) return res.status(400).json({ error: `unknown scope "${req.query?.scope}"` });
    const storagePath = storagePathForScope(scope, p, projects);
    if (!storagePath) return res.status(400).json({ error: "project has no storage path" });
    const removed = new IntegrationStore(storagePath).remove(req.params.slug);
    if (!removed) return res.status(404).end();
    // Record is gone → svc.mcpServer(null) yields def:null → drop any auto MCP.
    reconcileMcp(getPluginService(req.params.slug), storagePath, scope, p);
    res.status(204).end();
  });
}
