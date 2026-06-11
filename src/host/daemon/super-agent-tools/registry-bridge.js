// daemon/super-agent-tools/registry-bridge.js
//
// Generic bridge that exposes registry-backed HTTP tools (browser, fetch,
// search, glob, grep, etc.) to the super-agent — no per-tool import boilerplate.
//
// How it works:
//   1. Read TOOL_DEFINITIONS from daemon/tools/registry.js
//   2. Drop entries whose names collide with native super-agent tools (those
//      win — they touch in-process state directly).
//   3. For each remaining entry, produce { name, schema, makeHandler } in the
//      exact shape index.js expects, so they slot into TOOL_SCHEMAS alongside
//      the native ones.
//   4. The generated handler POSTs/GETs to the daemon's own HTTP server on
//      127.0.0.1:<port>. Yes, the super-agent talks to its own daemon — that
//      keeps the bridge dead-simple, lets the engine adapter format tool
//      schemas uniformly, and reuses the exact code path external callers hit.
//
// Net result: adding a tool = adding one entry to registry.js. No file in
// super-agent-tools/tools/, no import in index.js.

import fs from "node:fs";
import { TOOL_DEFINITIONS } from "#core/tools/registry.js";
import { TOKEN_PATH } from "#core/config/index.js";

// The bridge POSTs to the daemon's OWN HTTP server, which is behind the bearer
// auth middleware (see api/shared.js). Without a token every bridged tool call
// (web_search, browser_*, http_*, glob, grep) comes back 401 "unauthorized" —
// which is exactly what the super-agent hit. We read the daemon's master token from
// ~/.apx/daemon.token (the same file the CLI authenticates with) and cache it.
let cachedToken = null;
function daemonToken() {
  if (cachedToken !== null) return cachedToken;
  cachedToken =
    process.env.APX_TOKEN ||
    (() => {
      try {
        return fs.readFileSync(TOKEN_PATH, "utf8").trim();
      } catch {
        return "";
      }
    })();
  return cachedToken;
}

// Native handlers in super-agent-tools/tools/ that own these names. The bridge
// MUST skip them or the registry version (HTTP roundtrip) would shadow the
// native one with possibly different semantics.
const NATIVE_NAMES = new Set([
  "list_projects", "list_agents", "list_vault_agents", "import_agent",
  "add_project", "list_mcps", "read_agent_memory",
  "list_files", "read_file", "write_file", "edit_file", "search_files",
  "run_shell", "tail_messages", "search_messages",
  "call_agent", "call_mcp", "call_runtime",
  "send_telegram", "set_identity", "set_permission_mode",
]);

// Default allow-list of categories the bridge will expose. The NATIVE_NAMES
// filter handles duplicates inside these categories (e.g. "file" contains
// both read_file [native] and glob [bridged]). Anything outside is ignored
// — "shell"/"mcp"/"memory"/"session" have different semantics handled
// natively. Override with env APX_BRIDGE_CATEGORIES.
const DEFAULT_CATEGORIES = new Set(["browser", "fetch", "search", "file"]);

function buildSchema(entry) {
  return {
    type: "function",
    function: {
      name: entry.name,
      description: entry.description,
      parameters: entry.parameters || { type: "object", properties: {} },
    },
  };
}

function buildHandler(entry) {
  return ({ globalConfig }) => async (args = {}) => {
    const port = globalConfig?.port || process.env.APX_PORT || 7430;
    const method = String(entry.endpoint?.method || "POST").toUpperCase();
    let url = `http://127.0.0.1:${port}${entry.endpoint?.path || ""}`;

    const token = daemonToken();
    const opts = {
      method,
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
    };

    if (method === "GET" || method === "HEAD") {
      const qs = new URLSearchParams();
      for (const [k, v] of Object.entries(args)) {
        if (v === undefined || v === null) continue;
        qs.set(k, typeof v === "object" ? JSON.stringify(v) : String(v));
      }
      const q = qs.toString();
      if (q) url += (url.includes("?") ? "&" : "?") + q;
    } else {
      opts.body = JSON.stringify(args);
    }

    let res, text;
    try {
      res = await fetch(url, opts);
      text = await res.text();
    } catch (e) {
      return { error: `bridge fetch failed: ${e.message}`, url };
    }

    let parsed;
    try { parsed = JSON.parse(text); }
    catch { parsed = { raw: text }; }

    if (!res.ok) {
      return {
        error: parsed?.error || `HTTP ${res.status}`,
        status: res.status,
        ...(typeof parsed === "object" ? parsed : {}),
      };
    }
    return parsed;
  };
}

/**
 * Returns an array of tool objects in the shape super-agent-tools/index.js
 * expects: { name, schema, makeHandler }.
 *
 * @param {object} opts
 * @param {Set<string>=} opts.categories   override DEFAULT_CATEGORIES
 * @param {Set<string>=} opts.skipNames    extra names to skip in addition to NATIVE_NAMES
 */
export function buildBridgedTools(opts = {}) {
  const categories = opts.categories instanceof Set ? opts.categories : DEFAULT_CATEGORIES;
  const skipNames = opts.skipNames instanceof Set ? opts.skipNames : new Set();

  return TOOL_DEFINITIONS
    .filter(e => categories.has(e.category))
    .filter(e => !NATIVE_NAMES.has(e.name) && !skipNames.has(e.name))
    .filter(e => e.endpoint?.path)
    .map(entry => ({
      name: entry.name,
      // Carried through so the lazy-tools catalog can group on-demand tools by
      // their registry category (browser/fetch/search/file) for discover_tools.
      category: entry.category,
      schema: buildSchema(entry),
      makeHandler: buildHandler(entry),
    }));
}

export { NATIVE_NAMES, DEFAULT_CATEGORIES };
