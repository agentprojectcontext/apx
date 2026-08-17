// Tool registry — lookup and HTTP surface.
//
// Endpoints registered by api.js (mounted under /api):
//   GET  /api/tools              → lightweight list [{name, description, category, schema_url}]
//   GET  /api/tools/:name        → full schema + examples
//   POST /api/tools/:name/call   → execute the tool (proxy to internal handler)
//
// The catalog itself lives in ./catalog.js and the in-process executors in
// ./inline-handlers.js. This module only indexes and serves them.
import { TOOL_DEFINITIONS } from "./catalog.js";
import { makeInlineHandlers } from "./inline-handlers.js";


// ---------------------------------------------------------------------------
// Index for fast lookup
// ---------------------------------------------------------------------------

const TOOL_MAP = new Map(TOOL_DEFINITIONS.map((t) => [t.name, t]));

function listTools() {
  return TOOL_DEFINITIONS.map(({ name, description, category, endpoint }) => ({
    name,
    description,
    category,
    schema_url: `/api/tools/${name}`,
    endpoint_method: endpoint?.method || "inline",
    endpoint_path: endpoint?.path || null,
  }));
}

function getTool(name) {
  const t = TOOL_MAP.get(name);
  if (!t) return null;
  return {
    name: t.name,
    description: t.description,
    category: t.category,
    parameters: t.parameters,
    examples: t.examples || [],
    endpoint: t.endpoint || null,
    schema_url: `/api/tools/${name}`,
  };
}


// ---------------------------------------------------------------------------
// Express router factory
// ---------------------------------------------------------------------------

export function buildRegistryRouter(express, ctx) {
  const { projects, registries } = ctx;
  const router = express.Router();
  const inlineHandlers = makeInlineHandlers({ projects, registries });

  // GET /api/tools — lightweight list
  router.get("/", (_req, res) => {
    res.json(listTools());
  });

  // GET /api/tools/:name — full schema
  router.get("/:name", (req, res) => {
    const tool = getTool(req.params.name);
    if (!tool) return res.status(404).json({ error: `tool "${req.params.name}" not found` });
    res.json(tool);
  });

  // POST /api/tools/:name/call — execute tool
  router.post("/:name/call", async (req, res) => {
    const { name } = req.params;
    const toolDef = TOOL_MAP.get(name);
    if (!toolDef) return res.status(404).json({ error: `tool "${name}" not found` });

    const body = req.body || {};

    // If there's an inline handler, use it
    if (inlineHandlers[name]) {
      try {
        const result = await inlineHandlers[name](body);
        return res.json({ tool: name, result });
      } catch (e) {
        return res.status(500).json({ error: e.message });
      }
    }

    // Otherwise proxy to the HTTP endpoint
    if (!toolDef.endpoint) {
      return res.status(501).json({ error: `tool "${name}" has no endpoint and no inline handler` });
    }

    try {
      const { default: fetch } = await import("node-fetch");
      const port = process.env.APX_PORT || 7430;
      const base = `http://localhost:${port}`;

      let urlPath = toolDef.endpoint.path;
      // Replace :pid / :slug / :name params from body if present
      urlPath = urlPath
        .replace(":pid", body.project || "0")
        .replace(":slug", body.agent || body.slug || "")
        .replace(":sid", body.session_id || "")
        .replace(":id", body.session_id || "")
        .replace(":name", body.name || "");

      const method = toolDef.endpoint.method || "GET";
      let fetchUrl = `${base}${urlPath}`;

      const fetchOpts = { method, headers: { "content-type": "application/json" } };

      if (method === "GET") {
        // Append body fields as query params
        const qs = new URLSearchParams();
        for (const [k, v] of Object.entries(body)) {
          if (v !== undefined && v !== null) qs.set(k, String(v));
        }
        const qstr = qs.toString();
        if (qstr) fetchUrl += `?${qstr}`;
      } else {
        fetchOpts.body = JSON.stringify(body);
      }

      const r = await fetch(fetchUrl, fetchOpts);
      const text = await r.text();
      let data;
      try { data = JSON.parse(text); } catch { data = { raw: text }; }

      if (!r.ok) return res.status(r.status).json({ error: data?.error || text });
      res.json({ tool: name, result: data });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  return router;
}

// TOOL_DEFINITIONS is re-exported so the agent-side bridge
// (core/agent/tools/registry-bridge.js) keeps its existing import path.
export { listTools, getTool };
export { TOOL_DEFINITIONS } from "./catalog.js";
