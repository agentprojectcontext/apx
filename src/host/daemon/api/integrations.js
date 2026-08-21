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
import { verifyState, callbackUrl } from "#core/integrations/plugins/_google-oauth.js";
import { asyncRoute } from "./shared.js";

// The browser origin behind this request, reconstructed so an OAuth redirect URI
// built at authorize-time matches the one the callback trades the code with.
function requestOrigin(req) {
  const proto = String(req.headers["x-forwarded-proto"] || (req.secure ? "https" : "http")).split(",")[0].trim();
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  return `${proto}://${host}`;
}

// The little page the OAuth popup lands on: tells the opener panel it's done and
// closes itself. Kept self-contained (no bundle) since it renders outside the SPA.
function oauthResultPage(ok, message = "") {
  const title = ok ? "Conectado ✓" : "No se pudo conectar";
  const detail = ok ? "Ya podés cerrar esta ventana." : String(message || "Reintentá desde el panel.");
  const safe = detail.replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[c]);
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<body style="margin:0;font:15px/1.5 system-ui,sans-serif;background:#0b0f14;color:#e6edf3;display:grid;place-items:center;height:100vh">
<div style="max-width:22rem;text-align:center;padding:1.5rem">
  <div style="font-size:2rem;margin-bottom:.5rem">${ok ? "✅" : "⚠️"}</div>
  <h1 style="font-size:1.05rem;margin:0 0 .35rem">${title}</h1>
  <p style="margin:0;color:#9aa7b4">${safe}</p>
</div>
<script>
  try { window.opener && window.opener.postMessage({ source: "apx-oauth", ok: ${ok ? "true" : "false"} }, "*"); } catch (e) {}
  ${ok ? "setTimeout(function(){ try { window.close(); } catch (e) {} }, 1200);" : ""}
</script>`;
}

// Integration scope vocabulary: project | global, accepting "default" for
// global and both "shared" and "runtime" for project. See the note in
// api/mcps.js — do not merge these three helpers.
function normalizeIntegrationScope(raw) {
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

export function register(api, { projects, project, registries }) {
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

  // OAuth redirect landing. Google sends the browser here (no bearer token — see
  // the auth allowlist in shared.js), with a signed `state` that says which
  // plugin/project/scope started the flow. We trade the code for a refresh token
  // and persist it, then render a page that tells the panel it's done.
  api.get("/integrations/oauth/callback", asyncRoute(async (req, res) => {
    const fail = (msg) => res.status(400).type("html").send(oauthResultPage(false, msg));
    const { code, state, error } = req.query || {};
    if (error) return fail(`Google devolvió un error: ${error}`);
    const decoded = verifyState(state);
    if (!decoded || !code) return fail("El enlace de autorización venció o es inválido. Reintentá desde el panel.");
    const svc = getPluginService(decoded.slug);
    if (!svc || typeof svc.completeOAuth !== "function") return fail(`El plugin "${decoded.slug}" no soporta OAuth.`);
    const scope = normalizeIntegrationScope(decoded.scope) || "project";
    const p = projects.get(Number(decoded.pid) || 0);
    if (!p) return fail("No encontré el proyecto para guardar la conexión.");
    const storagePath = storagePathForScope(scope, p, projects);
    if (!storagePath) return fail("El proyecto no tiene ruta de storage.");
    const store = new IntegrationStore(storagePath);
    const record = store.get(decoded.slug);
    if (!record) return fail("La integración no está configurada (¿cargaste el client_id?).");
    try {
      const redirectUri = callbackUrl(requestOrigin(req));
      const { patch } = await svc.completeOAuth(record, { code: String(code), redirectUri });
      store.upsert(decoded.slug, patch);
      reconcileMcp(svc, storagePath, scope, p);
      res.type("html").send(oauthResultPage(true));
    } catch (e) {
      fail(e.message || String(e));
    }
  }));

  // List stored integrations in the chosen scope (secrets redacted).
  api.get("/projects/:pid/integrations", (req, res) => {
    const p = project(req, res);
    if (!p) return;
    const scope = normalizeIntegrationScope(req.query?.scope);
    if (scope === null) return res.status(400).json({ error: `unknown scope "${req.query?.scope}"` });
    const storagePath = storagePathForScope(scope, p, projects);
    if (!storagePath) return res.status(400).json({ error: "project has no storage path" });
    const records = new IntegrationStore(storagePath).list().map(redactRecord);
    res.json(records);
  });

  // The full plugin roster with each plugin's resolved status for this project
  // (project record wins over the default/global one).
  api.get("/projects/:pid/integrations/catalog", (req, res) => {
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
          defaultStorage: storagePathForScope("global", p, projects),
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
  api.get("/projects/:pid/integrations/:slug", (req, res) => {
    const p = project(req, res);
    if (!p) return;
    const svc = getPluginService(req.params.slug);
    if (!svc) return res.status(404).json({ error: `unknown plugin "${req.params.slug}"` });
    const scope = normalizeIntegrationScope(req.query?.scope);
    if (scope === null) return res.status(400).json({ error: `unknown scope "${req.query?.scope}"` });
    const storagePath = storagePathForScope(scope, p, projects);
    if (!storagePath) return res.status(400).json({ error: "project has no storage path" });
    const record = new IntegrationStore(storagePath).get(req.params.slug);
    res.json(svc.status(record));
  });

  // Save credentials / config. Creates the record if missing.
  api.post("/projects/:pid/integrations/:slug/configure", (req, res) => {
    const p = project(req, res);
    if (!p) return;
    const svc = getPluginService(req.params.slug);
    if (!svc) return res.status(404).json({ error: `unknown plugin "${req.params.slug}"` });
    const scope = normalizeIntegrationScope(req.query?.scope);
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
  api.post("/projects/:pid/integrations/:slug/validate", asyncRoute(async (req, res) => {
    const p = project(req, res);
    if (!p) return;
    const svc = getPluginService(req.params.slug);
    if (!svc) return res.status(404).json({ error: `unknown plugin "${req.params.slug}"` });
    const scope = normalizeIntegrationScope(req.query?.scope);
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
  }));

  // Disable a plugin without deleting its stored credentials.
  api.post("/projects/:pid/integrations/:slug/deactivate", (req, res) => {
    const p = project(req, res);
    if (!p) return;
    const svc = getPluginService(req.params.slug);
    if (!svc) return res.status(404).json({ error: `unknown plugin "${req.params.slug}"` });
    const scope = normalizeIntegrationScope(req.query?.scope);
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
  api.post("/projects/:pid/integrations/:slug/action/:action", asyncRoute(async (req, res) => {
    const p = project(req, res);
    if (!p) return;
    const svc = getPluginService(req.params.slug);
    if (!svc) return res.status(404).json({ error: `unknown plugin "${req.params.slug}"` });
    const fn = svc.actions?.[req.params.action];
    if (typeof fn !== "function") {
      return res.status(404).json({ error: `unknown action "${req.params.action}"` });
    }
    const scope = normalizeIntegrationScope(req.query?.scope);
    if (scope === null) return res.status(400).json({ error: `unknown scope "${req.query?.scope}"` });
    const storagePath = storagePathForScope(scope, p, projects);
    if (!storagePath) return res.status(400).json({ error: "project has no storage path" });
    const record = new IntegrationStore(storagePath).get(req.params.slug);
    if (!record) return res.status(404).json({ error: "integration not configured" });
    try {
      // Actions get a 2nd ctx arg (existing plugins ignore it). Obsidian's
      // sync_memory uses it to reach every project's memory.md; calendar's
      // authorize uses `origin` to build the OAuth redirect URI.
      const actionCtx = { storagePath, scope, project: p, projects, registries, origin: requestOrigin(req) };
      res.json(await fn.call(svc.actions, record, actionCtx));
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  }));

  // Remove a stored integration entirely.
  api.delete("/projects/:pid/integrations/:slug", (req, res) => {
    const p = project(req, res);
    if (!p) return;
    const scope = normalizeIntegrationScope(req.query?.scope);
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
