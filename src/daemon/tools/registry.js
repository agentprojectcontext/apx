// daemon/tools/registry.js
// Tool Registry on-demand for APX.
//
// Endpoints registered by api.js:
//   GET  /tools              → lightweight list [{name, description, category, schema_url}]
//   GET  /tools/:name        → full schema + examples
//   POST /tools/:name/call   → execute the tool (proxy to internal handler)
//
// Tools that already exist as HTTP endpoints are listed here with their
// endpoint targets — no code duplication.

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

const TOOL_DEFINITIONS = [
  // ── file ──────────────────────────────────────────────────────────────────
  {
    name: "read_file",
    category: "file",
    description: "Read the contents of a file inside the project.",
    endpoint: { method: "GET", path: "/files", query: ["path", "project"] },
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Relative path inside the project" },
        project: { type: "string", description: "Project ID or path (optional)" },
      },
      required: ["path"],
    },
    examples: [{ path: "src/index.js" }],
  },
  {
    name: "write_file",
    category: "file",
    description: "Write or overwrite a file inside the project.",
    endpoint: { method: "POST", path: "/files" },
    parameters: {
      type: "object",
      properties: {
        path: { type: "string" },
        content: { type: "string" },
        project: { type: "string" },
      },
      required: ["path", "content"],
    },
    examples: [{ path: "notes.md", content: "# Hello" }],
  },
  {
    name: "list_files",
    category: "file",
    description: "List files and directories inside a project path.",
    endpoint: { method: "GET", path: "/files" },
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Sub-path to list (optional)" },
        project: { type: "string" },
      },
    },
    examples: [{ path: "src" }],
  },
  {
    name: "search_files",
    category: "file",
    description: "Search for files by name glob or content pattern in the project.",
    endpoint: { method: "GET", path: "/files/search" },
    parameters: {
      type: "object",
      properties: {
        q: { type: "string", description: "Search query (filename or content)" },
        project: { type: "string" },
      },
      required: ["q"],
    },
    examples: [{ q: "*.config.js" }],
  },

  // ── shell ─────────────────────────────────────────────────────────────────
  {
    name: "run_command",
    category: "shell",
    description: "Execute a shell command in the project directory. Returns stdout, stderr, exit_code.",
    endpoint: { method: "POST", path: "/run" },
    parameters: {
      type: "object",
      properties: {
        cmd: { type: "string", description: "Shell command to run" },
        cwd: { type: "string", description: "Working directory override" },
        project: { type: "string" },
        timeout_ms: { type: "integer", default: 30000 },
      },
      required: ["cmd"],
    },
    examples: [{ cmd: "ls -la" }, { cmd: "git log --oneline -5" }],
  },

  // ── memory ────────────────────────────────────────────────────────────────
  {
    name: "memory_get",
    category: "memory",
    description: "Read the memory.md of the default agent in a project.",
    endpoint: { method: "GET", path: "/memory" },
    parameters: {
      type: "object",
      properties: {
        project: { type: "string" },
      },
    },
    examples: [{}],
  },
  {
    name: "memory_set",
    category: "memory",
    description: "Overwrite the memory.md of the default agent in a project.",
    endpoint: { method: "POST", path: "/memory" },
    parameters: {
      type: "object",
      properties: {
        body: { type: "string", description: "Full content to write" },
        project: { type: "string" },
      },
      required: ["body"],
    },
    examples: [{ body: "# Agent Memory\n\n- Remember to greet the user." }],
  },
  {
    name: "memory_append",
    category: "memory",
    description: "Append text to the agent memory.md (read-modify-write).",
    endpoint: null, // implemented inline in the call handler
    parameters: {
      type: "object",
      properties: {
        text: { type: "string" },
        project: { type: "string" },
      },
      required: ["text"],
    },
    examples: [{ text: "\n- New fact to remember." }],
  },
  {
    name: "memory_list",
    category: "memory",
    description: "List all agents that have memory files in a project.",
    endpoint: null,
    parameters: {
      type: "object",
      properties: { project: { type: "string" } },
    },
    examples: [{}],
  },

  // ── session ───────────────────────────────────────────────────────────────
  {
    name: "session_list",
    category: "session",
    description: "List sessions for an agent in a project.",
    endpoint: { method: "GET", path: "/projects/:pid/agents/:slug/sessions" },
    parameters: {
      type: "object",
      properties: {
        project: { type: "string", description: "Project ID" },
        agent: { type: "string", description: "Agent slug" },
      },
      required: ["project", "agent"],
    },
    examples: [{ project: "1", agent: "sofia" }],
  },
  {
    name: "session_get",
    category: "session",
    description: "Get a session by filename.",
    endpoint: { method: "GET", path: "/projects/:pid/sessions/:sid" },
    parameters: {
      type: "object",
      properties: {
        project: { type: "string" },
        session_id: { type: "string" },
      },
      required: ["project", "session_id"],
    },
    examples: [{ project: "1", session_id: "2026-05-01-planning.md" }],
  },
  {
    name: "session_search",
    category: "session",
    description: "Search session content by text query across all agents in a project.",
    endpoint: { method: "GET", path: "/sessions/search" },
    parameters: {
      type: "object",
      properties: {
        q: { type: "string", description: "Search query" },
        project: { type: "string" },
        limit: { type: "integer", default: 20 },
      },
      required: ["q"],
    },
    examples: [{ q: "authentication bug" }],
  },
  {
    name: "session_compact",
    category: "session",
    description: "Compact (summarise and compress) a session conversation.",
    endpoint: { method: "POST", path: "/sessions/:id/compact" },
    parameters: {
      type: "object",
      properties: {
        session_id: { type: "string" },
        project: { type: "string" },
        agent: { type: "string" },
        model: { type: "string" },
      },
      required: ["project", "agent", "session_id"],
    },
    examples: [{ project: "1", agent: "sofia", session_id: "2026-05-01-planning.md" }],
  },

  // ── mcp ───────────────────────────────────────────────────────────────────
  {
    name: "mcp_list",
    category: "mcp",
    description: "List all MCP servers registered in a project.",
    endpoint: { method: "GET", path: "/mcp" },
    parameters: {
      type: "object",
      properties: { project: { type: "string" } },
    },
    examples: [{}],
  },
  {
    name: "mcp_run",
    category: "mcp",
    description: "Call a tool on an MCP server.",
    endpoint: { method: "POST", path: "/mcp/run" },
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "MCP server name" },
        tool: { type: "string", description: "Tool name on that server" },
        params: { type: "object" },
        project: { type: "string" },
      },
      required: ["name", "tool"],
    },
    examples: [{ name: "filesystem", tool: "list_directory", params: { path: "/tmp" } }],
  },

  // ── glob / grep ───────────────────────────────────────────────────────────
  {
    name: "glob",
    category: "file",
    description: "List files matching a glob pattern (e.g. **/*.js). Uses native Node.js glob.",
    endpoint: { method: "POST", path: "/tools/glob" },
    parameters: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "Glob pattern, e.g. src/**/*.ts" },
        cwd: { type: "string", description: "Base directory (absolute path)" },
        dot: { type: "boolean", default: false, description: "Include dotfiles" },
        absolute: { type: "boolean", default: false },
        limit: { type: "integer", default: 500 },
      },
      required: ["pattern"],
    },
    examples: [
      { pattern: "**/*.js", cwd: "/my/project" },
      { pattern: "src/**/*.ts", cwd: "/my/project", limit: 100 },
    ],
  },
  {
    name: "grep",
    category: "file",
    description: "Search file contents by regex pattern. Uses ripgrep when available, pure Node.js fallback.",
    endpoint: { method: "POST", path: "/tools/grep" },
    parameters: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "Regex to search for" },
        path: { type: "string", description: "Directory or file to search in" },
        glob: { type: "string", description: "Glob filter for files, e.g. *.ts" },
        case_sensitive: { type: "boolean", default: false },
        context: { type: "integer", default: 0, description: "Lines of context around matches" },
        limit: { type: "integer", default: 100 },
      },
      required: ["pattern"],
    },
    examples: [
      { pattern: "export default", path: "/my/project/src", glob: "*.js" },
      { pattern: "TODO|FIXME", path: "/my/project", context: 2 },
    ],
  },

  // ── browser ───────────────────────────────────────────────────────────────
  {
    name: "browser_navigate",
    category: "browser",
    description: "Navigate the headless browser to a URL.",
    endpoint: { method: "POST", path: "/tools/browser/navigate" },
    parameters: {
      type: "object",
      properties: { url: { type: "string" } },
      required: ["url"],
    },
    examples: [{ url: "https://example.com" }],
  },
  {
    name: "browser_screenshot",
    category: "browser",
    description: "Take a screenshot of the current browser page. Returns base64 PNG.",
    endpoint: { method: "POST", path: "/tools/browser/screenshot" },
    parameters: {
      type: "object",
      properties: { full_page: { type: "boolean", default: false } },
    },
    examples: [{}],
  },
  {
    name: "browser_click",
    category: "browser",
    description: "Click a CSS selector on the current browser page.",
    endpoint: { method: "POST", path: "/tools/browser/click" },
    parameters: {
      type: "object",
      properties: { selector: { type: "string" } },
      required: ["selector"],
    },
    examples: [{ selector: "button#submit" }],
  },
  {
    name: "browser_type",
    category: "browser",
    description: "Type text into a CSS selector on the current browser page.",
    endpoint: { method: "POST", path: "/tools/browser/type" },
    parameters: {
      type: "object",
      properties: {
        selector: { type: "string" },
        text: { type: "string" },
        clear: { type: "boolean", default: true },
      },
      required: ["selector", "text"],
    },
    examples: [{ selector: "input#search", text: "hello world" }],
  },
  {
    name: "browser_fetch",
    category: "browser",
    description: "Fetch a URL via the headless browser (bypasses some network blocks). Falls back to node-fetch.",
    endpoint: { method: "POST", path: "/tools/browser/fetch" },
    parameters: {
      type: "object",
      properties: {
        url: { type: "string" },
        method: { type: "string", default: "GET" },
        headers: { type: "object" },
        body: { type: "string" },
      },
      required: ["url"],
    },
    examples: [{ url: "https://api.example.com/data" }],
  },
  {
    name: "browser_get_text",
    category: "browser",
    description: "Extract readable text from the current browser page.",
    endpoint: { method: "POST", path: "/tools/browser/get_text" },
    parameters: { type: "object", properties: {} },
    examples: [{}],
  },
  {
    name: "browser_evaluate",
    category: "browser",
    description: "Execute arbitrary JavaScript in the current browser page and return the result.",
    endpoint: { method: "POST", path: "/tools/browser/evaluate" },
    parameters: {
      type: "object",
      properties: { code: { type: "string", description: "JS code to eval (function body)" } },
      required: ["code"],
    },
    examples: [{ code: "return document.title;" }],
  },

  // ── search ────────────────────────────────────────────────────────────────
  {
    name: "web_search",
    category: "search",
    description: "Search the web. Modes: auto (tries DDG → Brave → Browser), ddg, brave, browser.",
    endpoint: { method: "POST", path: "/tools/search" },
    parameters: {
      type: "object",
      properties: {
        query: { type: "string" },
        mode: { type: "string", enum: ["auto", "ddg", "brave", "browser"], default: "auto" },
        limit: { type: "integer", default: 5 },
      },
      required: ["query"],
    },
    examples: [
      { query: "APC agent project context standard" },
      { query: "site:github.com puppeteer examples", mode: "ddg" },
    ],
  },

  // ── agents ────────────────────────────────────────────────────────────────
  {
    name: "agent_list",
    category: "agents",
    description: "List all agents in a project.",
    endpoint: { method: "GET", path: "/projects/:pid/agents" },
    parameters: {
      type: "object",
      properties: { project: { type: "string" } },
      required: ["project"],
    },
    examples: [{ project: "1" }],
  },
  {
    name: "agent_get",
    category: "agents",
    description: "Get details + memory for a specific agent.",
    endpoint: { method: "GET", path: "/projects/:pid/agents/:slug" },
    parameters: {
      type: "object",
      properties: {
        project: { type: "string" },
        agent: { type: "string" },
      },
      required: ["project", "agent"],
    },
    examples: [{ project: "1", agent: "sofia" }],
  },

  // ── project ───────────────────────────────────────────────────────────────
  {
    name: "project_info",
    category: "project",
    description: "List all registered projects and their metadata.",
    endpoint: { method: "GET", path: "/projects" },
    parameters: { type: "object", properties: {} },
    examples: [{}],
  },
];

// ---------------------------------------------------------------------------
// Index for fast lookup
// ---------------------------------------------------------------------------

const TOOL_MAP = new Map(TOOL_DEFINITIONS.map((t) => [t.name, t]));

function listTools() {
  return TOOL_DEFINITIONS.map(({ name, description, category, endpoint }) => ({
    name,
    description,
    category,
    schema_url: `/tools/${name}`,
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
    schema_url: `/tools/${name}`,
  };
}

// ---------------------------------------------------------------------------
// Inline call handlers for tools without a dedicated HTTP endpoint
// ---------------------------------------------------------------------------

function makeInlineHandlers({ projects, registries }) {
  return {
    memory_append: async (body) => {
      const { default: fetch } = await import("node-fetch");
      const base = `http://localhost:${process.env.APX_PORT || 7430}`;
      // GET current
      const getRes = await fetch(`${base}/memory${body.project ? `?project=${body.project}` : ""}`);
      if (!getRes.ok) throw new Error(`memory_get failed: ${getRes.status}`);
      const { body: current } = await getRes.json();
      // POST updated
      const text = body.text || "";
      const postRes = await fetch(`${base}/memory${body.project ? `?project=${body.project}` : ""}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body: current + text }),
      });
      if (!postRes.ok) throw new Error(`memory_set failed: ${postRes.status}`);
      return { ok: true, appended_chars: text.length };
    },

    memory_list: async (body) => {
      const { default: fs } = await import("node:fs");
      const { default: path } = await import("node:path");
      // Find the project
      const all = projects.list();
      let p = null;
      if (body.project) {
        const ref = String(body.project);
        const found = all.find((x) => String(x.id) === ref || x.path === ref);
        p = found ? projects.get(found.id) : null;
      }
      if (!p) p = projects.get(all.filter((x) => x.id !== 0)[0]?.id) || projects.get(0);
      if (!p) throw new Error("no project registered");
      const agentsDir = path.join(p.path, ".apc", "agents");
      if (!fs.existsSync(agentsDir)) return { agents_with_memory: [] };
      const result = fs.readdirSync(agentsDir).filter((slug) => {
        return fs.existsSync(path.join(agentsDir, slug, "memory.md"));
      }).map((slug) => {
        const memPath = path.join(agentsDir, slug, "memory.md");
        const stat = fs.statSync(memPath);
        return { agent: slug, path: memPath, size: stat.size, mtime: stat.mtime };
      });
      return { project: p.path, agents_with_memory: result };
    },
  };
}

// ---------------------------------------------------------------------------
// Express router factory
// ---------------------------------------------------------------------------

export function buildRegistryRouter(express, ctx) {
  const { projects, registries } = ctx;
  const router = express.Router();
  const inlineHandlers = makeInlineHandlers({ projects, registries });

  // GET /tools — lightweight list
  router.get("/", (_req, res) => {
    res.json(listTools());
  });

  // GET /tools/:name — full schema
  router.get("/:name", (req, res) => {
    const tool = getTool(req.params.name);
    if (!tool) return res.status(404).json({ error: `tool "${req.params.name}" not found` });
    res.json(tool);
  });

  // POST /tools/:name/call — execute tool
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

      let fetchOpts = { method, headers: { "content-type": "application/json" } };

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

export { listTools, getTool, TOOL_DEFINITIONS };
