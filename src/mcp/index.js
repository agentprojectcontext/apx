#!/usr/bin/env node
// APX MCP Server — exposes APX daemon capabilities via MCP stdio transport.
// Usage: npx -y apx-mcp   (run from inside an APC project directory)
//
// Tool surface:
//   agent_list        — list agents in the current project
//   agent_exec        — quick one-shot LLM call via apx exec
//   agent_run         — launch a full runtime session
//   memory_read       — read an agent's memory.md
//   memory_append     — append a fact to agent memory
//   messages_tail     — recent messages (all channels or filtered)
//   session_list      — list sessions for an agent
//   mcp_list          — list project+global MCPs
//   mcp_call          — call a project MCP tool

import path from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { findApfRoot } from "../core/parser.js";
import { ensureDaemon, http } from "../cli/http.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = parseInt(process.env.APX_PORT || "7430", 10);

// ---------------------------------------------------------------------------
// Resolve current project
// ---------------------------------------------------------------------------

async function resolveProject() {
  const cwd = process.env.APX_PROJECT_ROOT || process.cwd();
  const root = findApfRoot(cwd);
  if (!root) throw new Error(`No APC project found at or above: ${cwd}`);

  // Ensure daemon is running and project is registered.
  await ensureDaemon({ silent: true });
  const projects = await http.get("/projects");
  const match = projects.find((p) => path.resolve(p.path) === path.resolve(root));
  if (match) return match;

  // Register if not yet known.
  const created = await http.post("/projects", { path: root });
  return created;
}

// ---------------------------------------------------------------------------
// Build MCP server
// ---------------------------------------------------------------------------

const server = new McpServer({
  name: "apx",
  version: "0.1.0",
});

// agent_list
server.tool(
  "agent_list",
  "List all agents defined in the current APC project.",
  {},
  async () => {
    const proj = await resolveProject();
    const agents = await http.get(`/projects/${proj.id}/agents`);
    const rows = agents.map(
      (a) => `${a.slug}  role=${a.role || "—"}  model=${a.model || "—"}`
    );
    return { content: [{ type: "text", text: rows.join("\n") || "(no agents)" }] };
  }
);

// agent_exec
server.tool(
  "agent_exec",
  "Quick one-shot LLM call to an agent (apx exec). Returns the agent's response text.",
  {
    slug: z.string().describe("Agent slug"),
    prompt: z.string().describe("Prompt to send"),
    engine: z.string().optional().describe("Engine override (default: agent's model)"),
  },
  async ({ slug, prompt, engine }) => {
    const proj = await resolveProject();
    const body = { prompt };
    if (engine) body.engine = engine;
    const result = await http.post(`/projects/${proj.id}/agents/${slug}/exec`, body);
    return { content: [{ type: "text", text: result.output || JSON.stringify(result) }] };
  }
);

// agent_run
server.tool(
  "agent_run",
  "Launch a full runtime session for an agent (apx run). Returns the session result.",
  {
    slug: z.string().describe("Agent slug"),
    prompt: z.string().describe("Prompt / task for the agent"),
    runtime: z.string().optional().describe("Runtime: claude-code | codex | opencode | aider | cursor-agent | gemini-cli | qwen-code (default: claude-code)"),
  },
  async ({ slug, prompt, runtime }) => {
    const proj = await resolveProject();
    const body = { prompt, runtime: runtime || "claude-code" };
    const result = await http.post(`/projects/${proj.id}/agents/${slug}/runtime`, body);
    return { content: [{ type: "text", text: result.output || JSON.stringify(result) }] };
  }
);

// memory_read
server.tool(
  "memory_read",
  "Read an agent's persistent memory.",
  {
    slug: z.string().describe("Agent slug"),
  },
  async ({ slug }) => {
    const proj = await resolveProject();
    const mem = await http.get(`/projects/${proj.id}/agents/${slug}/memory`);
    return { content: [{ type: "text", text: mem.body_md || "(empty)" }] };
  }
);

// memory_append
server.tool(
  "memory_append",
  "Append a durable fact to an agent's memory (non-destructive).",
  {
    slug: z.string().describe("Agent slug"),
    fact: z.string().describe("Fact to append"),
  },
  async ({ slug, fact }) => {
    const proj = await resolveProject();
    await http.put(`/projects/${proj.id}/agents/${slug}/memory`, { append: fact });
    return { content: [{ type: "text", text: "OK" }] };
  }
);

// messages_tail
server.tool(
  "messages_tail",
  "Tail recent messages for the project (all channels or filtered).",
  {
    channel: z.string().optional().describe("Channel filter: runtime | telegram | exec | a2a"),
    agent: z.string().optional().describe("Filter by agent slug"),
    limit: z.number().optional().describe("Max messages (default 50)"),
  },
  async ({ channel, agent, limit }) => {
    const proj = await resolveProject();
    const qs = new URLSearchParams();
    if (channel) qs.set("channel", channel);
    if (agent) qs.set("agent", agent);
    if (limit) qs.set("limit", String(limit));
    const msgs = await http.get(`/projects/${proj.id}/messages?${qs}`);
    const rows = (msgs.messages || msgs).map(
      (m) => `[${m.ts}] ${m.channel}/${m.direction} ${m.author || ""}: ${m.body}`
    );
    return { content: [{ type: "text", text: rows.join("\n") || "(no messages)" }] };
  }
);

// session_list
server.tool(
  "session_list",
  "List recent sessions for an agent.",
  {
    slug: z.string().describe("Agent slug"),
    limit: z.number().optional().describe("Max sessions (default 20)"),
  },
  async ({ slug, limit }) => {
    const proj = await resolveProject();
    const qs = limit ? `?limit=${limit}` : "";
    const sessions = await http.get(`/projects/${proj.id}/agents/${slug}/sessions${qs}`);
    const rows = (sessions.sessions || sessions).map(
      (s) => `${s.filename}  started=${s.started_at || "—"}  title=${s.title || "—"}`
    );
    return { content: [{ type: "text", text: rows.join("\n") || "(no sessions)" }] };
  }
);

// mcp_list
server.tool(
  "mcp_list",
  "List MCP servers available in this project (from .apc/mcps.json, .cursor/mcp.json, ~/.apx/mcp.json, etc.).",
  {},
  async () => {
    const proj = await resolveProject();
    const mcps = await http.get(`/projects/${proj.id}/mcps`);
    const rows = (mcps.mcps || mcps).map(
      (m) => `${m.name}  source=${m.source}  transport=${m.transport}  enabled=${m.enabled}`
    );
    return { content: [{ type: "text", text: rows.join("\n") || "(no MCPs)" }] };
  }
);

// mcp_call
server.tool(
  "mcp_call",
  "Call a tool on a project MCP server.",
  {
    server: z.string().describe("MCP server name"),
    tool: z.string().describe("Tool name"),
    args: z.record(z.unknown()).optional().describe("Tool arguments as JSON object"),
  },
  async ({ server: serverName, tool, args }) => {
    const proj = await resolveProject();
    const result = await http.post(
      `/projects/${proj.id}/mcps/${encodeURIComponent(serverName)}/call`,
      { tool, args: args || {} }
    );
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  }
);

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

const transport = new StdioServerTransport();
await server.connect(transport);
