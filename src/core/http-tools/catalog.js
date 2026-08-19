// The HTTP tool catalog — data, not code.
//
// 548 of registry.js's 738 lines were this array. Mixing a catalog with the
// index that reads it, the handlers that run it, and the router that serves it
// meant every edit to any of the four loaded all of them, and adding a tool
// looked like editing a 738-line module instead of appending to a list.
//
// Each entry is one tool: name, category, description, JSON-Schema parameters,
// examples, and either an `endpoint` (a daemon route that already implements
// it — no duplication) or nothing, in which case inline-handlers.js runs it.
//
// Kept as .js rather than .json on purpose: the section comments below are real
// orientation, JSON has no comments, and Object.freeze costs nothing here.

export const TOOL_DEFINITIONS = Object.freeze([
  // NOTE: there is no `search_files` here. It pointed at GET /api/files/search,
  // a route that has never existed, so the HTTP surface advertised a tool that
  // always 404'd. Search by name with `glob`, by content with `grep` — both
  // have real routes. The agent keeps its own native search_files handler
  // (core/agent/tools/handlers/search-files.js), which is unaffected.
  // ── file ──────────────────────────────────────────────────────────────────
  {
    name: "read_file",
    category: "file",
    description: "Read the contents of a file inside the project.",
    endpoint: { method: "GET", path: "/api/files", query: ["path", "project"] },
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
    endpoint: { method: "POST", path: "/api/files" },
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
    endpoint: { method: "GET", path: "/api/files" },
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
    // Native loop tool. Listed so the agent picker can toggle it; HTTP /call
    // is 501 — the exec_agent loop runs the in-process handler.
    name: "edit_file",
    category: "file",
    description: "Replace one exact string with another inside a project file. Prefer this over write_file for small edits.",
    endpoint: null,
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Relative path inside the project" },
        search: { type: "string", description: "Exact text to replace" },
        replace: { type: "string", description: "Replacement text" },
        all: { type: "boolean", description: "Replace every match; default false" },
        project: { type: "string" },
      },
      required: ["path", "search", "replace"],
    },
    examples: [{ path: "README.md", search: "old", replace: "new" }],
  },

  // ── shell ─────────────────────────────────────────────────────────────────
  {
    name: "run_command",
    category: "shell",
    description: "Execute a shell command in the project directory. Returns stdout, stderr, exit_code.",
    endpoint: { method: "POST", path: "/api/run" },
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
    endpoint: { method: "GET", path: "/api/memory" },
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
    endpoint: { method: "POST", path: "/api/memory" },
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
    endpoint: { method: "GET", path: "/api/projects/:pid/agents/:slug/sessions" },
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
    endpoint: { method: "GET", path: "/api/projects/:pid/sessions/:sid" },
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
    endpoint: { method: "GET", path: "/api/sessions/search" },
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
    endpoint: { method: "POST", path: "/api/sessions/:id/compact" },
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
    endpoint: { method: "GET", path: "/api/mcp" },
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
    endpoint: { method: "POST", path: "/api/mcp/run" },
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
    endpoint: { method: "POST", path: "/api/tools/glob" },
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
    endpoint: { method: "POST", path: "/api/tools/grep" },
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

  // ── fetch (native HTTP, no browser) ───────────────────────────────────────
  {
    name: "http_get",
    category: "fetch",
    description: "Native HTTP GET — fast, no headless browser. Use for REST APIs, raw HTML, JSON endpoints.",
    endpoint: { method: "POST", path: "/api/tools/fetch/get" },
    parameters: {
      type: "object",
      properties: {
        url: { type: "string" },
        headers: { type: "object" },
        timeout_ms: { type: "number", default: 30000 },
      },
      required: ["url"],
    },
    examples: [{ url: "https://api.github.com/repos/anthropics/anthropic-sdk-typescript" }],
  },
  {
    name: "http_post",
    category: "fetch",
    description: "Native HTTP POST — sends body as JSON when body is an object. Use for REST APIs.",
    endpoint: { method: "POST", path: "/api/tools/fetch/post" },
    parameters: {
      type: "object",
      properties: {
        url: { type: "string" },
        body: { description: "Object → JSON-stringified. String → sent as-is." },
        headers: { type: "object" },
        timeout_ms: { type: "number", default: 30000 },
        json: { type: "boolean", description: "Force JSON parsing of response body." },
      },
      required: ["url"],
    },
    examples: [{ url: "https://api.example.com/items", body: { name: "foo" } }],
  },
  {
    name: "http_request",
    category: "fetch",
    description: "Generic HTTP request with full control over method, headers, body, timeout.",
    endpoint: { method: "POST", path: "/api/tools/fetch/request" },
    parameters: {
      type: "object",
      properties: {
        url: { type: "string" },
        method: { type: "string", default: "GET" },
        headers: { type: "object" },
        body: {},
        timeout_ms: { type: "number", default: 30000 },
        json: { type: "boolean" },
      },
      required: ["url"],
    },
    examples: [{ url: "https://api.example.com/x", method: "DELETE" }],
  },

  // ── browser (Puppeteer-backed — heavier, launches Chromium lazily) ────────
  {
    name: "browser_navigate",
    category: "browser",
    description: "Navigate the headless browser to a URL. Launches Chromium lazily on first call. Auto-retries and falls back to a more permissive wait strategy on redirect-heavy sites.",
    endpoint: { method: "POST", path: "/api/tools/browser/navigate" },
    parameters: {
      type: "object",
      properties: {
        url: { type: "string" },
        wait_until: {
          type: "string",
          enum: ["load", "domcontentloaded", "networkidle0", "networkidle2"],
          description: "Puppeteer wait strategy (default networkidle2). Use 'domcontentloaded' for slow/redirect-heavy sites; navigate auto-falls back to it on failure anyway.",
        },
        launch_options: { type: "object", description: "Puppeteer launch overrides (headless, args, defaultViewport, etc.)." },
        allow_dangerous: { type: "boolean", description: "Allow dangerous launch args (--no-sandbox, --single-process, etc.)." },
      },
      required: ["url"],
    },
    examples: [{ url: "https://example.com" }],
  },
  {
    name: "browser_screenshot",
    category: "browser",
    description: "Take a screenshot of the current browser page (or an element via selector). Returns { base64, path?, bytes, url }. To send via Telegram, prefer `save_to_tmp: true` and pass the returned `path` to send_telegram({photo_path}); otherwise pass `base64` straight to send_telegram({photo_base64}). NEVER include the base64 in any text field — Telegram does not render it.",
    endpoint: { method: "POST", path: "/api/tools/browser/screenshot" },
    parameters: {
      type: "object",
      properties: {
        selector:    { type: "string",  description: "CSS selector of element to capture. Omit for full viewport/page." },
        full_page:   { type: "boolean", default: false },
        width:       { type: "number",  description: "Viewport width (capped at 1920)." },
        height:      { type: "number",  description: "Viewport height (capped at 1080)." },
        encoded:     { type: "boolean", description: "Also return a data:image/png;base64 URI in response." },
        save_path:   { type: "string",  description: "Absolute path to write the PNG. Returns it in `path`." },
        save_to_tmp: { type: "boolean", description: "Auto-write to <os.tmpdir>/apx-screenshots/screenshot-<ts>.png. Returns the path." },
      },
    },
    examples: [{}, { selector: "#hero" }, { save_to_tmp: true }],
  },
  {
    name: "browser_click",
    category: "browser",
    description: "Click a CSS selector on the current browser page.",
    endpoint: { method: "POST", path: "/api/tools/browser/click" },
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
    description: "Type text into a CSS selector. Uses focus + Ctrl+A + Backspace to clear, then types with realistic delay.",
    endpoint: { method: "POST", path: "/api/tools/browser/type" },
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
    name: "browser_select",
    category: "browser",
    description: "Choose an option in a <select> element by its value.",
    endpoint: { method: "POST", path: "/api/tools/browser/select" },
    parameters: {
      type: "object",
      properties: {
        selector: { type: "string" },
        value: { type: "string" },
      },
      required: ["selector", "value"],
    },
    examples: [{ selector: "select#country", value: "AR" }],
  },
  {
    name: "browser_hover",
    category: "browser",
    description: "Hover the cursor over an element (triggers tooltips, dropdowns, hover states).",
    endpoint: { method: "POST", path: "/api/tools/browser/hover" },
    parameters: {
      type: "object",
      properties: { selector: { type: "string" } },
      required: ["selector"],
    },
    examples: [{ selector: "nav .menu-item" }],
  },
  {
    name: "browser_evaluate",
    category: "browser",
    description: "Execute JavaScript in the page context. Captures the script's console.log/info/warn/error output and returns it alongside the result.",
    endpoint: { method: "POST", path: "/api/tools/browser/evaluate" },
    parameters: {
      type: "object",
      properties: { code: { type: "string", description: "JS code to eval (function body)." } },
      required: ["code"],
    },
    examples: [{ code: "return document.title;" }],
  },
  {
    name: "browser_get_text",
    category: "browser",
    description: "Extract readable text from the current page (or a single element). Strips script/style/nav/header/footer.",
    endpoint: { method: "POST", path: "/api/tools/browser/get_text" },
    parameters: {
      type: "object",
      properties: { selector: { type: "string", description: "Optional CSS selector." } },
    },
    examples: [{}, { selector: "article" }],
  },
  {
    name: "browser_get_content",
    category: "browser",
    description: "Return raw innerHTML of the page or a single element (truncated at 1MB).",
    endpoint: { method: "POST", path: "/api/tools/browser/get_content" },
    parameters: {
      type: "object",
      properties: { selector: { type: "string" } },
    },
    examples: [{}, { selector: "main" }],
  },
  {
    name: "browser_wait_for_selector",
    category: "browser",
    description: "Wait until a CSS selector appears on the page.",
    endpoint: { method: "POST", path: "/api/tools/browser/wait_for_selector" },
    parameters: {
      type: "object",
      properties: {
        selector: { type: "string" },
        timeout: { type: "number", default: 30000 },
      },
      required: ["selector"],
    },
    examples: [{ selector: ".results-loaded" }],
  },
  {
    name: "browser_close",
    category: "browser",
    description: "Close the headless browser and free resources.",
    endpoint: { method: "POST", path: "/api/tools/browser/close" },
    parameters: { type: "object", properties: {} },
    examples: [{}],
  },

  // ── search ────────────────────────────────────────────────────────────────
  {
    name: "web_search",
    category: "search",
    description: "Search the web. Modes: auto (tries DDG → Brave → Browser), ddg, brave, browser.",
    endpoint: { method: "POST", path: "/api/tools/search" },
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
    endpoint: { method: "GET", path: "/api/projects/:pid/agents" },
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
    endpoint: { method: "GET", path: "/api/projects/:pid/agents/:slug" },
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
    endpoint: { method: "GET", path: "/api/projects" },
    parameters: { type: "object", properties: {} },
    examples: [{}],
  },

  // ── skills (native) ───────────────────────────────────────────────────────
  {
    name: "list_skills",
    category: "skill",
    description: "List available skills (slug + one-line description). Call load_skill to fetch a body.",
    endpoint: null,
    parameters: {
      type: "object",
      properties: {
        project_path: { type: "string", description: "Optional project root to also scan .apc/skills" },
      },
    },
    examples: [{}],
  },
  {
    name: "load_skill",
    category: "skill",
    description: "Load the full body of a named skill into this turn.",
    endpoint: null,
    parameters: {
      type: "object",
      properties: {
        slug: { type: "string", description: "Skill slug from list_skills" },
        project_path: { type: "string" },
      },
      required: ["slug"],
    },
    examples: [{ slug: "apx-routine" }],
  },

  // ── telegram (native) ─────────────────────────────────────────────────────
  {
    name: "send_telegram",
    category: "telegram",
    description: "Send a Telegram message (text; optional photo/document). Dangerous — confirm or run under total.",
    endpoint: null,
    parameters: {
      type: "object",
      properties: {
        text: { type: "string" },
        chat_id: { type: "string" },
      },
      required: ["text"],
    },
    examples: [{ text: "Magui: listo el lote de ideas." }],
  },

  // ── asana (native plugin) ─────────────────────────────────────────────────
  {
    name: "asana_list_projects",
    category: "integrations",
    description: "List Asana projects visible to the configured token.",
    endpoint: null,
    parameters: { type: "object", properties: { project: { type: "string" } } },
    examples: [{}],
  },
  {
    name: "asana_list_tasks",
    category: "integrations",
    description: "List tasks in an Asana project.",
    endpoint: null,
    parameters: {
      type: "object",
      properties: {
        project_gid: { type: "string" },
        completed: { type: "boolean" },
        project: { type: "string" },
      },
      required: ["project_gid"],
    },
    examples: [{ project_gid: "123" }],
  },
  {
    name: "asana_create_task",
    category: "integrations",
    description: "Create a task in an Asana project.",
    endpoint: null,
    parameters: {
      type: "object",
      properties: {
        project_gid: { type: "string" },
        name: { type: "string" },
        notes: { type: "string" },
        project: { type: "string" },
      },
      required: ["project_gid", "name"],
    },
    examples: [{ project_gid: "123", name: "Reel agro" }],
  },
  {
    name: "asana_update_task",
    category: "integrations",
    description: "Update an Asana task (name, notes, completed, section).",
    endpoint: null,
    parameters: {
      type: "object",
      properties: {
        task_gid: { type: "string" },
        name: { type: "string" },
        completed: { type: "boolean" },
        project: { type: "string" },
      },
      required: ["task_gid"],
    },
    examples: [{ task_gid: "456", completed: true }],
  },
]);

// Tools a freshly created agent gets out of the box. Read/search the project,
// keep its own memory, and look itself up in the org — everything with a side
// effect (shell, write, browser, MCP, network) stays opt-in per agent.
// One source of truth: the daemon applies these on create, and the web
// preselects them so the create dialog needs no tool picker at all.
export const DEFAULT_AGENT_TOOLS = Object.freeze([
  "read_file",
  "list_files",
  "glob",
  "grep",
  "memory_get",
  "memory_set",
  "memory_append",
  "memory_list",
  "agent_list",
  "agent_get",
  "project_info",
]);

// Worker / editor agents (Magui and friends): the safe default PLUS write,
// surgical edit, shell, and on-demand skills. Browser, HTTP, MCP, and
// session tools stay opt-in. Asana / Telegram are extra per-agent.
export const EDITOR_AGENT_TOOLS = Object.freeze([
  ...DEFAULT_AGENT_TOOLS,
  "write_file",
  "edit_file",
  "run_command",
  "list_skills",
  "load_skill",
]);
